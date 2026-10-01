import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parseEnv } from "node:util";

test("computer deployment preserves existing secrets and reuses the worker token", async () => {
  const root = resolve("spikes/subscription-runners/.results");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "computer-config-test-"));
  const script = resolve("infra/configure-computer.mjs");
  const configuration = join(directory, ".openmuse/deploy.env");
  await mkdir(join(directory, ".openmuse"));
  const original = {
    TOKEN_ENCRYPTION_KEY: "encryption-test",
    GOOGLE_CLIENT_SECRET: "google-test",
    OPENMUSE_OWNER_SETUP_KEY: "owner-test",
    OPENAI_API_KEY: "gateway-test",
    PUBLIC_API_URL: "https://example.test",
  };
  await writeFile(
    configuration,
    Object.entries(original)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  try {
    const run = () => spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8" });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const values = parseEnv(await readFile(configuration, "utf8"));
    for (const [key, value] of Object.entries(original)) assert.equal(values[key], value);
    assert.equal(values.COMPUTER_ENABLED, "true");
    assert.equal(values.DOCKER_TLS_VERIFY, "1");
    assert.ok(values.WORKER_TOKEN && values.WORKER_TOKEN.length >= 32);
    assert.ok(!first.stdout.includes(values.WORKER_TOKEN));
    assert.equal(run().status, 0);
    assert.equal(parseEnv(await readFile(configuration, "utf8")).WORKER_TOKEN, values.WORKER_TOKEN);
  } finally {
    assert.ok(directory.startsWith(`${root}/computer-config-test-`));
    await rm(directory, { recursive: true });
  }
});
