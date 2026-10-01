import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Preparation only. Input and output stay in this project's ignored private directory.
const source = parseEnv(await readFile(resolve(".openmuse/openbot-spike/source.env"), "utf8"));
assert.ok(source.CPK_INTELLIGENCE_API_KEY);
const directory = resolve(".openmuse/openbot-personal");
await mkdir(directory, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString("hex");
const postgres = { POSTGRES_USER: "openbot", POSTGRES_PASSWORD: password, POSTGRES_DB: "openbot" };
const server = {
  NODE_ENV: "production",
  PORT: "3001",
  SERVER_PORT: "3001",
  OPENBOT_SINGLE_USER: "false",
  DATABASE_URL: `postgres://openbot:${password}@openbot-personal-db:5432/openbot`,
  KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  OPENBOT_ORGANIZATION_AUTH_URL: "https://moonscapenas.time-mora.ts.net:8443",
  OPENBOT_PUBLIC_URL: "http://100.114.236.60:18902",
  AGENT_ENDPOINT_ALLOWED_HOSTS: "moonscapenas.time-mora.ts.net:8443",
  INTELLIGENCE_API_KEY: source.CPK_INTELLIGENCE_API_KEY,
  INTELLIGENCE_API_URL: "https://api.intelligence.copilotkit.ai",
  INTELLIGENCE_GATEWAY_WS_URL: "wss://realtime.intelligence.copilotkit.ai",
  COPILOTKIT_TELEMETRY_DISABLED: "true",
  DO_NOT_TRACK: "1",
};
for (const [name, values] of [
  ["postgres.env", postgres],
  ["server.env", server],
])
  await writeFile(
    resolve(directory, name),
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600, flag: "wx" },
  );
console.log(
  "Prepared private OpenBot settings without Google, gateway, owner-password or Docker credentials.",
);
