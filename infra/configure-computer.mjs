import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Run in the moonscape deployment checkout. Never print gateway or worker secrets.
const path = resolve(".openmuse/deploy.env");
assert.ok((await lstat(path)).isFile());
const original = await readFile(path, "utf8");
const env = parseEnv(original);
assert.ok(env.TOKEN_ENCRYPTION_KEY && env.GOOGLE_CLIENT_SECRET);
const settings = {
  COMPUTER_ENABLED: "true",
  COMPUTER_IMAGE: "openmuse-computer:cf855db",
  COMPUTER_DEPLOYMENT_ID: "zeeshan-personal-jetson",
  DOCKER_HOST: "tcp://100.114.236.60:2376",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/run/openmuse/docker-tls",
  BROWSER_WORKER_URL: "http://100.114.236.60:8790",
  WORKER_TOKEN: env.WORKER_TOKEN || randomBytes(32).toString("base64url"),
};
const updated = `${original
  .split("\n")
  .filter((line) => !Object.hasOwn(settings, line.split("=", 1)[0]))
  .join("\n")
  .trimEnd()}\n${Object.entries(settings)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n")}\n`;
const values = parseEnv(updated);
for (const [key, value] of Object.entries(env)) {
  if (!Object.hasOwn(settings, key)) assert.equal(values[key], value);
}
for (const [key, value] of Object.entries(settings)) assert.equal(values[key], value);
const suffix = `${Date.now()}-${process.pid}`;
const backup = `${path}.before-computer-${suffix}`;
await copyFile(path, backup, constants.COPYFILE_EXCL);
const temporary = `${path}.computer-${suffix}`;
await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
assert.equal(
  await readFile(path, "utf8"),
  original,
  "Deployment configuration changed during update",
);
await rename(temporary, path);
console.log(JSON.stringify({ computerConfigured: true, secretsPreserved: true, backup }));
