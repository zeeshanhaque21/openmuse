import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, lstat, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Run in moonscape's deployment checkout. Preserve all existing account, model and Google settings.
const path = resolve(".openmuse/deploy.env");
assert.ok((await lstat(path)).isFile());
const original = await readFile(path, "utf8");
const env = parseEnv(original);
assert.ok(env.TOKEN_ENCRYPTION_KEY && env.GOOGLE_CLIENT_SECRET && env.WORKER_TOKEN);
const settings = {
  AGENT_BACKEND: "openbot",
  OPENBOT_URL: "http://100.114.236.60:18902",
  OPENBOT_CALLBACK_URL: "https://moonscapenas.time-mora.ts.net:8443",
};
const updated = `${original
  .split("\n")
  .filter((line) => !Object.hasOwn(settings, line.split("=", 1)[0]))
  .join("\n")
  .trimEnd()}\n${Object.entries(settings)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n")}\n`;
const values = parseEnv(updated);
for (const [key, value] of Object.entries(env))
  if (!Object.hasOwn(settings, key)) assert.equal(values[key], value);
const suffix = `${Date.now()}-${process.pid}`;
const backup = `${path}.before-openbot-${suffix}`;
await copyFile(path, backup, constants.COPYFILE_EXCL);
const temporary = `${path}.openbot-${suffix}`;
await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
assert.equal(
  await readFile(path, "utf8"),
  original,
  "Deployment changed while configuring OpenBot",
);
await rename(temporary, path);
console.log(JSON.stringify({ openBotConfigured: true, secretsPreserved: true, backup }));
