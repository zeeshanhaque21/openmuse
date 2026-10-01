import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAuth } from "../../apps/server/src/auth.ts";
import type { Config } from "../../apps/server/src/config.ts";
import { createStore } from "../../apps/server/src/db.ts";
import { AppError } from "../../apps/server/src/errors.ts";

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
const dataDir = await mkdtemp(resolve(directory, "owner-"));
const db = await createStore({ dataDir: resolve(dataDir, "db") });
const config: Config = {
  mode: "live",
  host: "127.0.0.1",
  port: 18901,
  publicUrl: "http://127.0.0.1:18901",
  dataDir,
  ownerSetupKey: randomUUID(),
  agentBackend: "model",
  intelligenceApiKey: "unused-by-authority",
  googleRedirectUri: "http://127.0.0.1:18901/api/google/callback",
  allowedOrigins: [],
};
const auth = await createAuth(db, config);
const authority = new Hono();
authority.get("/api/me", async (c) => c.json(await auth.openBotIdentity(c.req.header("cookie"))));
authority.onError((error, c) =>
  c.json({ error: error.message }, error instanceof AppError ? error.status : 500),
);
const server = serve({ fetch: authority.fetch, hostname: config.host, port: config.port });
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const log = openSync(resolve(directory, `upstream-${Date.now()}.log`), "a", 0o600);
const upstreamEnvironment = Object.fromEntries(
  (await readFile(resolve(directory, "upstream.env"), "utf8"))
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const offset = line.indexOf("=");
      return [line.slice(0, offset), line.slice(offset + 1)];
    }),
);
const gateway = new URL(upstreamEnvironment.OPENAI_BASE_URL);
upstreamEnvironment.BOT_MODEL = upstreamEnvironment.BOT_MODEL.replace(/^openai[/:]/i, "");
if (["localhost", "127.0.0.1"].includes(gateway.hostname)) {
  gateway.protocol = "https:";
  gateway.hostname = "moonscapenas.time-mora.ts.net";
  gateway.port = "";
  upstreamEnvironment.OPENAI_BASE_URL = gateway.toString();
}
const child = spawn(
  "bun",
  [
    `--env-file=${resolve(directory, "upstream.env")}`,
    "spikes/openbot-integration/launch-upstream.ts",
  ],
  {
    cwd: process.cwd(),
    stdio: ["ignore", log, log],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      INTELLIGENCE_API_URL: "https://api.intelligence.copilotkit.ai",
      INTELLIGENCE_GATEWAY_WS_URL: "wss://realtime.intelligence.copilotkit.ai",
      ...upstreamEnvironment,
    },
  },
);
let agent: ProxiedCopilotRuntimeAgent | undefined;
try {
  const url = "http://127.0.0.1:18902";
  const deadline = Date.now() + 90_000;
  while (true) {
    if (child.exitCode !== null)
      throw new Error(`Upstream startup failed (${child.exitCode}); inspect private log`);
    if (Date.now() >= deadline)
      throw new Error("Upstream startup exceeded 90 seconds; inspect private log");
    const response = await fetch(`${url}/api/me`, { signal: AbortSignal.timeout(2000) }).catch(
      () => null,
    );
    if (response?.status === 401) break;
    await delay(500);
  }
  const { token } = await auth.setup(config.ownerSetupKey ?? "", `smoke-password-${randomUUID()}`);
  const offered = await fetch(`${url}/api/auth/organization/session`, {
    method: "POST",
    headers: { origin: url, "content-type": "application/json" },
    body: JSON.stringify({ cookie: await auth.openBotCookie(`Bearer ${token}`) }),
  });
  assert.equal(offered.status, 200, "Identity handoff failed");
  const { ticket } = await offered.json();
  const redeemed = await fetch(`${url}/api/auth/organization/session?ticket=${ticket}`, {
    redirect: "manual",
  });
  assert.equal(redeemed.status, 303);
  const cookie = redeemed.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `${path} returned HTTP ${response.status}; inspect private log`);
    return response.json();
  };
  const { user } = await request("/api/me");
  assert.equal(user.role, "user");
  const { agent: bot } = await request("/api/agents", {
    name: "OpenMuse bridge proof",
    title: "Private integration smoke",
    roleDescription:
      "Reply concisely. Never call tools or take external actions. Echo a requested verification code exactly.",
    visibility: "private",
  });
  const { channel } = await request("/api/channels", { agentIds: [bot.id] });
  const info = await request("/api/copilotkit/info");
  assert.equal(info.mode, "intelligence");
  assert.ok(info.agents[bot.id]);
  agent = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: `${url}/api/copilotkit`,
    agentId: bot.id,
    headers: { cookie },
  });
  agent.threadId = channel.threadId;
  const code = `OPENMUSE_BRIDGE_${randomUUID()}`;
  agent.addMessage({
    id: randomUUID(),
    role: "user",
    content: `Reply with only this verification code: ${code}`,
  });
  let streamed = false;
  const subscription = agent.subscribe({
    onTextMessageContentEvent: () => {
      streamed = true;
    },
  });
  await bounded(
    agent.runAgent({ runId: randomUUID() }),
    120_000,
    "Live conversation exceeded 120 seconds",
  );
  subscription.unsubscribe();
  assert.ok(streamed, "No streamed text received");
  assert.ok(
    agent.messages.some(
      (message) =>
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.includes(code),
    ),
    "Verification code missing from answer",
  );
  const restored = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: `${url}/api/copilotkit`,
    agentId: bot.id,
    headers: { cookie },
  });
  restored.threadId = channel.threadId;
  await bounded(restored.connectAgent(), 30_000, "History reload exceeded 30 seconds");
  assert.ok(
    restored.messages.some(
      (message) =>
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.includes(code),
    ),
    "Stored history did not reload",
  );
  restored.abortRun();
  await auth.logout(`Bearer ${token}`);
  assert.equal((await fetch(`${url}/api/me`, { headers: { cookie } })).status, 401);
  const result = {
    upstream: "2e096d685ff0f18b5e80fd72e4ad71edb1d0be43",
    identity: "passed",
    stream: "passed",
    history: "passed",
    revocation: "passed",
    production: "unchanged",
  };
  await writeFile(
    resolve(directory, "runtime-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} finally {
  agent?.abortRun();
  if (child.pid && child.exitCode === null) {
    // Logs append directly to disk, and this PID is the child started above, not a pattern match.
    process.kill(child.pid, 0);
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(10_000),
    ]);
  }
  closeSync(log);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.close();
}
