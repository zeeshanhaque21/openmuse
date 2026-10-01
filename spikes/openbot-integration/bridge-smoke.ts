import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createApp } from "../../apps/server/src/app.ts";
import type { Config } from "../../apps/server/src/config.ts";
import { createStore } from "../../apps/server/src/db.ts";

async function bounded<T>(work: Promise<T>, milliseconds: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const directory = resolve(".openmuse/openbot-spike");
await mkdir(directory, { recursive: true, mode: 0o700 });
const source = parseEnv(await readFile(resolve(directory, "source.env"), "utf8"));
const upstreamEnv = parseEnv(await readFile(resolve(directory, "upstream.env"), "utf8"));
const gatewayUrl = new URL(source.OPENAI_BASE_URL);
if (["localhost", "127.0.0.1"].includes(gatewayUrl.hostname)) {
  gatewayUrl.protocol = "https:";
  gatewayUrl.hostname = "moonscapenas.time-mora.ts.net";
  gatewayUrl.port = "";
}
const observedModels: string[] = [];
let cancelStarted = false;
let cancelReachedGateway = false;
const gateway = new Hono();
gateway.all("/v1/*", async (c) => {
  const body = c.req.method === "GET" ? undefined : await c.req.text();
  if (body) {
    const parsed = JSON.parse(body);
    if (typeof parsed.model === "string") observedModels.push(parsed.model);
    const latest = parsed.messages
      ?.filter((message: { role: string }) => message.role === "user")
      .at(-1);
    if (String(latest?.content).includes("OPENMUSE_CANCEL_PROOF")) {
      // A deterministic delayed model stream isolates stop propagation without another model call.
      return streamSSE(c, async (stream) => {
        cancelStarted = true;
        const cancelled = new Promise<void>((resolve) =>
          stream.onAbort(() => {
            cancelReachedGateway = true;
            resolve();
          }),
        );
        await stream.writeSSE({
          data: JSON.stringify({
            id: "cancel-proof",
            object: "chat.completion.chunk",
            created: 1,
            model: parsed.model,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Waiting for stop" },
                finish_reason: null,
              },
            ],
          }),
        });
        await bounded(cancelled, 60_000, "Delayed stream did not cancel");
      });
    }
  }
  const path = new URL(c.req.url).pathname.replace(/^\/v1/, "");
  const response = await fetch(`${gatewayUrl.toString().replace(/\/$/, "")}${path}`, {
    method: c.req.method,
    headers: {
      Authorization: `Bearer ${source.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body,
    signal: c.req.raw.signal,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
});
const gatewayServer = serve({ fetch: gateway.fetch, hostname: "127.0.0.1", port: 18913 });
await new Promise<void>((resolve, reject) => {
  gatewayServer.once("listening", resolve);
  gatewayServer.once("error", reject);
});
const dataDir = await mkdtemp(resolve(directory, "bridge-owner-"));
const db = await createStore({ dataDir: resolve(dataDir, "db") });
const config: Config = {
  mode: "live",
  host: "127.0.0.1",
  port: 18911,
  publicUrl: "http://127.0.0.1:18911",
  dataDir,
  ownerSetupKey: randomBytes(24).toString("hex"),
  encryptionKey: randomBytes(32).toString("base64"),
  agentBackend: "openbot",
  openBotUrl: "http://127.0.0.1:18912",
  model: source.MODEL,
  modelGatewayUrl: "http://127.0.0.1:18913/v1",
  modelGatewayKey: source.OPENAI_API_KEY,
  intelligenceApiKey: source.CPK_INTELLIGENCE_API_KEY,
  googleRedirectUri: "http://127.0.0.1:18911/api/google/callback",
  allowedOrigins: [],
  taskWorkerEnabled: true,
  ...(process.argv.includes("--computer")
    ? {
        computerEnabled: true,
        computerImage: source.COMPUTER_IMAGE,
        computerDeploymentId: `openbot-proof-${randomUUID()}`,
        workerUrl: source.BROWSER_WORKER_URL,
        workerToken: source.WORKER_TOKEN,
      }
    : {}),
};
if (config.computerEnabled) {
  process.env.DOCKER_HOST = source.DOCKER_HOST;
  process.env.DOCKER_TLS_VERIFY = "1";
  process.env.DOCKER_CERT_PATH = resolve(directory, "docker-tls");
}
let instance = await createApp(db, config);
const api = serve({
  fetch: (request) => instance.app.fetch(request),
  hostname: config.host,
  port: config.port,
});
await new Promise<void>((resolve, reject) => {
  api.once("listening", resolve);
  api.once("error", reject);
});
const log = openSync(resolve(directory, `bridge-upstream-${Date.now()}.log`), "a", 0o600);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: "development",
  DATABASE_URL: upstreamEnv.DATABASE_URL.replace(/\/openbot_spike$/, "/openbot_bridge_spike"),
  KEY_ENCRYPTION_KEY: upstreamEnv.KEY_ENCRYPTION_KEY,
  INTELLIGENCE_API_KEY: source.CPK_INTELLIGENCE_API_KEY,
  INTELLIGENCE_API_URL: "https://api.intelligence.copilotkit.ai",
  INTELLIGENCE_GATEWAY_WS_URL: "wss://realtime.intelligence.copilotkit.ai",
  PORT: "18912",
  SERVER_PORT: "18912",
  OPENBOT_SINGLE_USER: "false",
  OPENBOT_ORGANIZATION_AUTH_URL: config.publicUrl,
  OPENBOT_PUBLIC_URL: config.openBotUrl,
  TENANT_PACKAGE_DIR: resolve("infra/openbot-tenant"),
  AGENT_ENDPOINT_ALLOWED_HOSTS: "127.0.0.1:18911",
};
// The upstream receives no model gateway credential. All inference is policy-owned by OpenMuse.
const migrations = spawn(
  "bun",
  ["node_modules/drizzle-kit/bin.cjs", "migrate", "--config=drizzle.config.ts"],
  {
    cwd: resolve("artifacts/openbot-source/server"),
    env,
    stdio: ["ignore", log, log],
  },
);
const migrationCode = await bounded(
  new Promise<number | null>((resolve) => migrations.once("exit", resolve)),
  60_000,
  "Migrations timed out",
);
assert.equal(migrationCode, 0, "Isolated upstream migrations failed; inspect private log");
const child = spawn("bun", ["spikes/openbot-integration/launch-upstream.ts"], {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", log, log],
});
let agent: ProxiedCopilotRuntimeAgent | undefined;
let token = "";
try {
  const deadline = Date.now() + 90_000;
  while (true) {
    if (child.exitCode !== null)
      throw new Error(`Upstream startup failed (${child.exitCode}); inspect private log`);
    if (Date.now() > deadline) throw new Error("Upstream startup timed out");
    if (
      (
        await fetch(`${config.openBotUrl}/api/me`, { signal: AbortSignal.timeout(2000) }).catch(
          () => null,
        )
      )?.status === 401
    )
      break;
    await delay(500);
  }
  const password = `bridge-password-${randomUUID()}`;
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${config.publicUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `${path} returned ${response.status}`);
    return response.json();
  };
  token = (await request("/api/session", { setupKey: config.ownerSetupKey, password })).token;
  const { threadId } = await request("/api/main-thread");
  const headers = { Authorization: `Bearer ${token}` };
  agent = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: `${config.publicUrl}/api/copilotkit`,
    agentId: "default",
    headers,
  });
  agent.threadId = threadId;
  const send = async (prompt: string) => {
    const current = agent;
    assert.ok(current);
    current.addMessage({ id: randomUUID(), role: "user", content: prompt });
    await bounded(
      current.runAgent({ runId: randomUUID() }),
      120_000,
      "OpenMuse/OpenBot turn timed out",
    );
    return current.messages.filter((message) => message.role === "assistant").at(-1)?.content;
  };
  const code = `OPENMUSE_FULL_BRIDGE_${randomUUID()}`;
  const firstModel = source.MODEL.replace(/^openai[/:]/, "");
  let secondModel = firstModel;
  let computer = "not-requested";
  if (!process.argv.includes("--stop-only")) {
    console.log("Bridge gate: initial turn");
    assert.ok(String(await send(`Reply with only this verification code: ${code}`)).includes(code));
    assert.equal(observedModels.at(-1), firstModel);
    const catalog = await request("/api/models");
    secondModel = catalog.models.find(
      (id: string) => id === "codex/gpt-5.6-sol-low" && id !== firstModel,
    );
    assert.ok(secondModel, "Need a second subscription model for picker synchronization proof");
    await request("/api/models/selection", { modelId: secondModel });
    const nextCode = `OPENMUSE_SELECTED_MODEL_${randomUUID()}`;
    console.log("Bridge gate: selected model");
    assert.ok(
      String(await send(`Reply with only this verification code: ${nextCode}`)).includes(nextCode),
    );
    assert.equal(observedModels.at(-1), secondModel);
    const linkBefore = await db.get("local-user", "openbot-threads", threadId);
    await instance.agent.stop();
    instance = await createApp(db, { ...config, model: "openai/should-not-be-used" });
    assert.equal((await request("/api/models")).activeModel, secondModel);
    const restored = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: `${config.publicUrl}/api/copilotkit`,
      agentId: "default",
      headers,
    });
    restored.threadId = threadId;
    await bounded(restored.connectAgent(), 30_000, "Native history reload timed out");
    assert.ok(
      restored.messages.some(
        (message) => message.role === "assistant" && String(message.content).includes(code),
      ),
    );
    agent = restored;
    const afterRestartCode = `OPENMUSE_RESTART_${randomUUID()}`;
    console.log("Bridge gate: restart");
    assert.ok(
      String(await send(`Reply with only this verification code: ${afterRestartCode}`)).includes(
        afterRestartCode,
      ),
    );
    assert.equal(observedModels.at(-1), secondModel);
    assert.deepEqual(await db.get("local-user", "openbot-threads", threadId), linkBefore);
    if (config.computerEnabled) {
      console.log("Bridge gate: computer");
      await request("/api/models/selection", { modelId: firstModel });
      const path = `/workspace/openbot-${randomUUID()}.txt`;
      const text = `JETSON_OPENBOT_${randomUUID()}`;
      await send(
        `Use start_computer and write_computer_file to write exactly ${text} to ${path}, then use read_computer_file to confirm the saved content. Do not delegate this task.`,
      );
      const file = await instance.computer.read("local-user", path);
      assert.ok(
        JSON.stringify(file).includes(text),
        "Real Jetson file did not contain expected content",
      );
      await instance.computer.stop("local-user");
      await instance.computer.start("local-user");
      assert.ok(JSON.stringify(await instance.computer.read("local-user", path)).includes(text));
      computer = "passed-file-write-read-and-restart";
    }
  }
  const scoped = await instance.auth.openBotCookie(`Bearer ${token}`);
  console.log("Bridge gate: cancellation");
  agent.addMessage({
    id: randomUUID(),
    role: "user",
    content: "OPENMUSE_CANCEL_PROOF: wait for my stop command",
  });
  const stopping = agent.runAgent({ runId: randomUUID() }).catch(() => {});
  await bounded(
    (async () => {
      while (!cancelStarted) await delay(100);
    })(),
    30_000,
    "Cancellation run never reached the model gateway",
  );
  agent.abortRun();
  await bounded(
    (async () => {
      while (!cancelReachedGateway) await delay(100);
    })(),
    30_000,
    "Stop did not reach the native model stream",
  );
  await bounded(stopping, 30_000, "Stopped client run did not settle");
  const reconnected = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: `${config.publicUrl}/api/copilotkit`,
    agentId: "default",
    headers,
  });
  reconnected.threadId = threadId;
  await bounded(reconnected.connectAgent(), 30_000, "History reconnect after stop did not settle");
  agent = reconnected;
  const resumedCode = `OPENMUSE_AFTER_STOP_${randomUUID()}`;
  console.log("Bridge gate: after stop");
  assert.ok(
    String(await send(`Reply with only this verification code: ${resumedCode}`)).includes(
      resumedCode,
    ),
  );
  const bad = await fetch(`${config.publicUrl}/api/openbot/agent/${encodeURIComponent(threadId)}`, {
    method: "POST",
    headers: { "x-openmuse-bridge": scoped, "content-type": "application/json" },
    body: JSON.stringify({
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  });
  assert.equal(bad.status, 403, "Callback accepted an unrelated upstream thread");
  await fetch(`${config.publicUrl}/api/session`, { method: "DELETE", headers });
  assert.equal(
    (await fetch(`${config.publicUrl}/api/me`, { headers: { cookie: scoped } })).status,
    401,
  );
  const result = process.argv.includes("--stop-only")
    ? {
        scope: "stop-only",
        stop: "passed-native-stream-cancellation",
        resumeAfterStop: "passed",
        production: "unchanged",
      }
    : {
        upstream: "2e096d685ff0f18b5e80fd72e4ad71edb1d0be43",
        nativeRuntimeBridge: "passed",
        modelPicker: [firstModel, secondModel],
        modelPersistence: "passed",
        history: "passed",
        channelIdentity: "passed",
        stop: "passed-native-stream-cancellation",
        resumeAfterStop: "passed",
        unauthorizedThread: "rejected",
        logout: "revoked",
        computer,
        production: "unchanged",
      };
  await writeFile(
    resolve(directory, "bridge-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} finally {
  agent?.abortRun();
  if (config.computerEnabled) await instance.computer.stop("local-user").catch(() => {});
  if (child.pid && child.exitCode === null) {
    process.kill(child.pid, 0);
    child.kill("SIGTERM");
    await bounded(
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      10_000,
      "Upstream did not stop",
    );
  }
  closeSync(log);
  await instance.agent.stop();
  await Promise.all(
    [api, gatewayServer].map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
  await db.close();
}
