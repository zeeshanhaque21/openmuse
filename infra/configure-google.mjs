import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, lstat, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Run from the deployed checkout. OAuth credentials enter through stdin, not arguments.
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  assert.ok(input.length <= 65536, "Credential file is too large");
}
const client = JSON.parse(input).web;
assert.ok(client, "Google credentials must be a Web application OAuth client");
for (const name of ["client_id", "client_secret"]) {
  assert.ok(
    typeof client[name] === "string" && client[name].trim() && !/[\r\n]/.test(client[name]),
    "Invalid Google credential file",
  );
}
const path = resolve(".openmuse/deploy.env");
assert.ok((await lstat(path)).isFile(), "Deployment environment must be a regular file");
const original = await readFile(path, "utf8");
const env = parseEnv(original);
assert.ok(env.TOKEN_ENCRYPTION_KEY, "Preserve the existing deployment encryption key");
const callback = `${env.PUBLIC_API_URL}/api/google/callback`;
assert.ok(
  client.redirect_uris?.includes(callback),
  "Register this deployment's exact callback URL in the Google OAuth client first",
);
const lines = original.split("\n").filter((line) => !/^GOOGLE_CLIENT_(ID|SECRET)=/.test(line));
const updated = `${lines.join("\n").trimEnd()}\nGOOGLE_CLIENT_ID=${client.client_id.trim()}\nGOOGLE_CLIENT_SECRET=${client.client_secret.trim()}\n`;
const values = parseEnv(updated);
assert.equal(values.GOOGLE_CLIENT_ID, client.client_id.trim());
assert.equal(values.GOOGLE_CLIENT_SECRET, client.client_secret.trim());
assert.equal(values.TOKEN_ENCRYPTION_KEY, env.TOKEN_ENCRYPTION_KEY);
assert.equal(values.OPENMUSE_OWNER_SETUP_KEY, env.OPENMUSE_OWNER_SETUP_KEY);
assert.equal(values.OPENAI_API_KEY, env.OPENAI_API_KEY);
const suffix = `${Date.now()}-${process.pid}`;
const backup = `${path}.before-google-${suffix}`;
await copyFile(path, backup, constants.COPYFILE_EXCL);
const temporary = `${path}.google-${suffix}`;
await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
// Verify again immediately before replacing the exact configuration file.
assert.equal(
  await readFile(path, "utf8"),
  original,
  "Deployment configuration changed during update; refusing to replace it",
);
await rename(temporary, path);
assert.equal(parseEnv(await readFile(path, "utf8")).TOKEN_ENCRYPTION_KEY, env.TOKEN_ENCRYPTION_KEY);
console.log(
  JSON.stringify({
    googleConfigured: true,
    encryptionKeyPreserved: true,
    ownerSetupKeyPreserved: true,
    gatewayKeyPreserved: true,
    callback,
    backup,
    secretsPrinted: false,
  }),
);
