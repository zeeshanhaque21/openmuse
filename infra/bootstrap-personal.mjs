import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Run on moonscape from this project's checkout. Secrets enter via stdin, never arguments.
const root = resolve(".openmuse");
const frontend = process.argv[2];
assert.ok(
  frontend && new URL(frontend).protocol === "https:",
  "An HTTPS frontend origin is required",
);
assert.equal(new URL(frontend).origin, frontend, "Use an origin without a path");
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { intelligenceApiKey } = JSON.parse(input);
assert.ok(
  typeof intelligenceApiKey === "string" && intelligenceApiKey.trim(),
  "CopilotKit project key required",
);
const gatewayKey = (
  await readFile("/home/moonscape/.omniroute-parallel/gateway-api-key.txt", "utf8")
).trim();
assert.ok(gatewayKey && !/[\r\n]/.test(gatewayKey), "Gateway key required");
assert.ok(!/[\r\n]/.test(intelligenceApiKey), "Invalid CopilotKit project key");
await mkdir(join(root, "data"), { recursive: true, mode: 0o700 });
const setupKey = randomBytes(32).toString("base64url");
const config = {
  HOST: "127.0.0.1",
  PORT: "8788",
  WORKSPACE_MODE: "live",
  AGENT_BACKEND: "model",
  DATA_DIR: "/data",
  TASK_WORKER_ENABLED: "true",
  COMPUTER_ENABLED: "false",
  PUBLIC_API_URL: "https://moonscapenas.time-mora.ts.net:8443",
  ALLOWED_ORIGINS: frontend,
  OPENMUSE_OWNER_SETUP_KEY: setupKey,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  OPENAI_BASE_URL: "http://127.0.0.1:20129/v1",
  OPENAI_API_KEY: gatewayKey,
  MODEL: "openai/codex/gpt-5.6-sol",
  CPK_INTELLIGENCE_API_KEY: intelligenceApiKey.trim(),
};
await writeFile(
  join(root, "deploy.env"),
  `${Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`,
  { mode: 0o600, flag: "wx" },
);
await writeFile(join(root, "owner-setup-code.txt"), `${setupKey}\n`, { mode: 0o600, flag: "wx" });
console.log(
  JSON.stringify({
    environmentCreated: true,
    secretsPrinted: false,
    ownerSetupCode: join(root, "owner-setup-code.txt"),
  }),
);
