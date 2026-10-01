import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(".openmuse/openbot-spike");
const source = Object.fromEntries(
  (await readFile(resolve(directory, "source.env"), "utf8"))
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const offset = line.indexOf("=");
      return [line.slice(0, offset), line.slice(offset + 1)];
    }),
);
for (const key of ["OPENAI_BASE_URL", "OPENAI_API_KEY", "MODEL", "CPK_INTELLIGENCE_API_KEY"]) {
  if (!source[key]?.trim()) throw new Error(`Missing ${key}`);
}
await mkdir(directory, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString("hex");
const gateway = new URL(source.OPENAI_BASE_URL);
if (["localhost", "127.0.0.1"].includes(gateway.hostname)) {
  // The production API shares moonscape's network; the local spike does not.
  gateway.protocol = "https:";
  gateway.hostname = "moonscapenas.time-mora.ts.net";
  gateway.port = "";
}
const postgres = {
  POSTGRES_USER: "openbot_spike",
  POSTGRES_PASSWORD: password,
  POSTGRES_DB: "openbot_spike",
};
const environment = {
  NODE_ENV: "development",
  DATABASE_URL: `postgres://openbot_spike:${password}@100.114.236.60:15432/openbot_spike`,
  KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  PORT: "18902",
  SERVER_PORT: "18902",
  OPENBOT_SINGLE_USER: "false",
  OPENBOT_ORGANIZATION_AUTH_URL: "http://127.0.0.1:18901",
  OPENBOT_PUBLIC_URL: "http://127.0.0.1:18902",
  TENANT_PACKAGE_DIR: resolve("artifacts/openbot-source/examples/fintech"),
  OPENAI_BASE_URL: gateway.toString(),
  OPENAI_API_KEY: source.OPENAI_API_KEY,
  BOT_PROVIDER: "openai",
  // OpenMuse's first segment selects its adapter; it is not part of the gateway model ID.
  BOT_MODEL: source.MODEL.replace(/^openai[/:]/i, ""),
  INTELLIGENCE_API_KEY: source.CPK_INTELLIGENCE_API_KEY,
  INTELLIGENCE_API_URL: "https://api.intelligence.copilotkit.ai",
  INTELLIGENCE_GATEWAY_WS_URL: "wss://realtime.intelligence.copilotkit.ai",
};
for (const [name, values] of [
  ["postgres.env", postgres],
  ["upstream.env", environment],
]) {
  await writeFile(
    resolve(directory, name),
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600, flag: "wx" },
  );
}
console.log(
  "Created private isolated OpenBot spike configuration; no production data or Google credentials copied into the upstream environment.",
);
