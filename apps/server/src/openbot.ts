import { createHash, randomUUID } from "node:crypto";
import { AbstractAgent } from "@ag-ui/client";
import {
  type BaseEvent,
  EventSchemas,
  EventType,
  type RunAgentInput,
  RunAgentInputSchema,
} from "@ag-ui/core";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Observable } from "rxjs";
import { z } from "zod";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import type { AgentService } from "./engine/service.ts";
import { AppError } from "./errors.ts";

const botSchema = z.object({ agent: z.object({ id: z.string().min(1) }) });
const channelSchema = z.object({
  channel: z.object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    agentIds: z.array(z.string()),
  }),
});
const relaySchemas = new Map(
  EventSchemas.options.map((schema) => [schema.shape.type.value, schema.strip()]),
);

/** Re-ingest protocol events, not the inner project's already-durable event envelopes. */
export function relayOpenBotEvent(event: BaseEvent, input: RunAgentInput): BaseEvent {
  const schema = relaySchemas.get(event.type as EventType);
  if (!schema) throw new AppError("OpenBot returned an unsupported event", 503);
  const { metadata: _metadata, rawEvent: _rawEvent, ...clean } = schema.parse(event);
  return {
    ...clean,
    ...("threadId" in clean ? { threadId: input.threadId } : {}),
    ...("runId" in clean ? { runId: input.runId } : {}),
    ...(clean.type === EventType.RUN_STARTED ? { input } : {}),
  };
}
type Link = {
  id: string;
  upstream: string;
  botId?: string;
  channelId?: string;
  remoteThreadId?: string;
  ready: boolean;
};

/** OpenBot owns its private channels; OpenMuse owns models, tools, credentials and approvals. */
export class OpenBotBridge {
  private readonly locks = new Map<string, Promise<unknown>>();
  readonly url: string;
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
  ) {
    if (!config.openBotUrl)
      throw new Error("OpenBot requires OPENBOT_URL; no native fallback is allowed");
    const url = new URL(config.openBotUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("OPENBOT_URL must be an HTTP(S) origin without credentials");
    this.url = url.origin;
  }
  agent(authorization?: string) {
    return new BridgeAgent(this, authorization);
  }

  async connection(authorization: string | undefined, threadId: string, signal: AbortSignal) {
    if (!this.config.openBotUrl) throw new AppError("OpenBot is not configured", 503);
    if (!threadId || threadId.length > 512) throw new AppError("Invalid conversation ID", 400);
    const owner = await this.auth.owner(authorization);
    const scopedCookie = await this.auth.openBotCookie(authorization);
    const fetchUpstream = async (path: string, options: RequestInit = {}, cookie?: string) => {
      const response = await fetch(`${this.url}${path}`, {
        ...options,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...options.headers,
        },
      });
      if (!response.ok)
        throw new AppError(
          "OpenBot is unavailable or refused this connection. No fallback was used.",
          503,
        );
      return response;
    };
    const handoff = await fetchUpstream("/api/auth/organization/session", {
      method: "POST",
      headers: { origin: this.url },
      body: JSON.stringify({ cookie: scopedCookie }),
    });
    const { ticket } = z.object({ ticket: z.string().uuid() }).parse(await handoff.json());
    const redeemed = await fetch(
      `${this.url}/api/auth/organization/session?ticket=${encodeURIComponent(ticket)}`,
      {
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      },
    );
    const cookie = redeemed.headers.get("set-cookie")?.split(";")[0];
    if (redeemed.status !== 303 || !cookie?.startsWith("openbot.organization-session="))
      throw new AppError("OpenBot identity handoff failed", 503);
    const locked = `${owner}:${threadId}`;
    const previous = this.locks.get(locked) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        let link = await this.db.get<Link>(owner, "openbot-threads", threadId);
        if (link && (link.upstream !== this.url || !link.ready))
          throw new AppError(
            "OpenBot conversation setup was interrupted or its server changed. Start a new conversation; no uncertain creation was retried.",
            503,
          );
        const callback = new URL(
          `/api/openbot/agent/${encodeURIComponent(threadId)}`,
          this.config.openBotCallbackUrl ?? this.config.publicUrl,
        ).toString();
        const profile = {
          name: "OpenMuse",
          title: `Personal conversation ${createHash("sha256").update(threadId).digest("hex").slice(0, 16)}`,
          roleDescription:
            "Personal OpenMuse agent. Use the owner's selected model and native tools. All external actions require OpenMuse's existing approval policy.",
          visibility: "private",
          endpoint: callback,
          auth: { header: "X-OpenMuse-Bridge", value: scopedCookie },
        };
        if (!link) {
          link = { id: threadId, upstream: this.url, ready: false };
          if (!(await this.db.insertIfAbsent(owner, "openbot-threads", link)))
            throw new AppError(
              "Conversation is being linked by another server. Retry after it finishes.",
              409,
            );
          const response = await fetchUpstream(
            "/api/agents",
            { method: "POST", body: JSON.stringify(profile) },
            cookie,
          );
          link.botId = botSchema.parse(await response.json()).agent.id;
          await this.db.put(owner, "openbot-threads", link);
          const created = await fetchUpstream(
            "/api/channels",
            { method: "POST", body: JSON.stringify({ agentIds: [link.botId] }) },
            cookie,
          );
          const { channel } = channelSchema.parse(await created.json());
          if (channel.agentIds.length !== 1 || channel.agentIds[0] !== link.botId)
            throw new AppError("OpenBot returned a different conversation", 503);
          link = { ...link, channelId: channel.id, remoteThreadId: channel.threadId, ready: true };
          await this.db.put(owner, "openbot-threads", link);
        } else {
          // Refresh the encrypted callback credential after a new login. It cannot authorize the workspace API.
          const updated = await fetchUpstream(
            `/api/agents/${encodeURIComponent(link.botId ?? "")}`,
            { method: "PATCH", body: JSON.stringify(profile) },
            cookie,
          );
          if (botSchema.parse(await updated.json()).agent.id !== link.botId)
            throw new AppError("OpenBot returned a different agent", 503);
          const response = await fetchUpstream(
            `/api/channels/${encodeURIComponent(link.channelId ?? "")}`,
            {},
            cookie,
          );
          const { channel } = channelSchema.parse(await response.json());
          if (
            channel.threadId !== link.remoteThreadId ||
            channel.agentIds.length !== 1 ||
            channel.agentIds[0] !== link.botId
          )
            throw new AppError("OpenBot conversation identity changed", 503);
        }
        return { link, cookie };
      });
    this.locks.set(locked, work);
    try {
      return await work;
    } finally {
      if (this.locks.get(locked) === work) this.locks.delete(locked);
    }
  }

  routes(service: AgentService) {
    const routes = new Hono();
    routes.get("/me", async (c) => c.json(await this.auth.openBotIdentity(c.req.header("cookie"))));
    routes.post("/openbot/agent/:threadId", async (c) => {
      const owner = await this.auth.openBotOwner(c.req.header("x-openmuse-bridge"));
      const input = RunAgentInputSchema.parse(await c.req.json());
      const localThreadId = c.req.param("threadId");
      const link = await this.db.get<Link>(owner, "openbot-threads", localThreadId);
      if (!link?.ready || link.upstream !== this.url || link.remoteThreadId !== input.threadId)
        throw new AppError("OpenBot conversation is not authorized", 403);
      const native = new ConversationAgent(
        { ...this.config, agentBackend: "model" },
        service,
        owner,
      );
      // Keep native browser sessions, choices, receipts and idempotency keys on the user's local thread.
      return streamSSE(c, async (stream) => {
        await new Promise<void>((resolve) => {
          let writes = Promise.resolve();
          let terminal = false;
          const subscription = native.run({ ...input, threadId: localThreadId }).subscribe({
            next: (event) => {
              if (event.type === EventType.RUN_ERROR || event.type === EventType.RUN_FINISHED)
                terminal = true;
              writes = writes
                .then(() =>
                  stream.writeSSE({
                    data: JSON.stringify({
                      ...event,
                      ...("threadId" in event ? { threadId: input.threadId } : {}),
                    }),
                  }),
                )
                .catch(() => {
                  subscription.unsubscribe();
                  resolve();
                });
            },
            error: () => {
              if (!terminal)
                writes = writes.then(() =>
                  stream.writeSSE({
                    data: JSON.stringify({
                      type: EventType.RUN_ERROR,
                      message: "OpenMuse agent connection failed",
                    }),
                  }),
                );
              void writes.finally(resolve);
            },
            complete: () => {
              void writes.finally(resolve);
            },
          });
          stream.onAbort(() => {
            subscription.unsubscribe();
            native.abortRun();
            resolve();
          });
        });
      });
    });
    return routes;
  }
}

class BridgeAgent extends AbstractAgent {
  constructor(
    private readonly bridge: OpenBotBridge,
    private readonly authorization?: string,
  ) {
    super({ agentId: "default" });
  }
  clone() {
    return new BridgeAgent(this.bridge, this.authorization);
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      const abort = new AbortController();
      let remote: ProxiedCopilotRuntimeAgent | undefined;
      let terminal = false;
      let subscription: { unsubscribe(): void } | undefined;
      void this.bridge
        .connection(this.authorization, input.threadId, abort.signal)
        .then(({ link, cookie }) => {
          if (abort.signal.aborted) return;
          remote = new ProxiedCopilotRuntimeAgent({
            runtimeUrl: `${this.bridge.url}/api/copilotkit`,
            agentId: link.botId,
            headers: { cookie },
          });
          remote.threadId = link.remoteThreadId ?? "";
          subscription = remote
            .run({
              ...input,
              threadId: link.remoteThreadId ?? "",
              // Intelligence run IDs are project-wide. The inner and outer runners must not collide.
              runId: randomUUID(),
              tools: input.tools.filter((tool) => tool.name === "open_workspace"),
            })
            .subscribe({
              next: (event) => {
                if (event.type === EventType.RUN_ERROR || event.type === EventType.RUN_FINISHED)
                  terminal = true;
                subscriber.next(relayOpenBotEvent(event, input));
              },
              error: () => {
                if (!terminal)
                  subscriber.next({
                    type: EventType.RUN_ERROR,
                    message: "OpenBot connection failed. Your selected model was not replaced.",
                  });
                subscriber.complete();
              },
              complete: () => subscriber.complete(),
            });
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            subscriber.next({
              type: EventType.RUN_ERROR,
              message:
                "OpenBot is unavailable or this conversation could not be linked. No fallback was used. Start a new conversation if setup was interrupted.",
            });
            subscriber.complete();
          }
        });
      return () => {
        abort.abort();
        remote?.abortRun();
        subscription?.unsubscribe();
      };
    });
  }
}
