import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { Auth, createAuth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("OpenBot authority credentials are scoped, least-privileged, stable and revocable", async () => {
  await mkdir(resolve(".openmuse/test"), { recursive: true });
  const dataDir = await mkdtemp(resolve(".openmuse/test/openbot-identity-"));
  const db = await createStore({ dataDir: resolve(dataDir, "db") });
  const config: Config = {
    mode: "live",
    host: "127.0.0.1",
    port: 8787,
    publicUrl: "http://127.0.0.1:8787",
    dataDir,
    ownerSetupKey: "identity-test-setup-code",
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://127.0.0.1:8787/api/google/callback",
    allowedOrigins: [],
  };
  try {
    const auth = await createAuth(db, config);
    const { token } = await auth.setup(config.ownerSetupKey ?? "", "test-owner-password-123");
    const authorization = `Bearer ${token}`;
    const cookie = await auth.openBotCookie(authorization);
    assert.ok(!cookie.includes(token));
    assert.match(cookie, /^better-auth\.session_token=[a-f0-9]{64}\.[a-f0-9]{64}$/);
    const identity = await auth.openBotIdentity(cookie);
    assert.equal(identity.user.role, "user");
    assert.notEqual(identity.user.id, "local-user");
    assert.deepEqual(await (await createAuth(db, config)).openBotIdentity(cookie), identity);
    await assert.rejects(new Auth(db, config, "different-deployment-key").openBotIdentity(cookie), {
      status: 401,
    });
    const another = await auth.session(undefined, "test-owner-password-123");
    assert.deepEqual(
      await auth.openBotIdentity(await auth.openBotCookie(`Bearer ${another.token}`)),
      identity,
    );
    await assert.rejects(auth.owner(`Bearer ${cookie.split("=")[1]}`), { status: 401 });
    await assert.rejects(auth.openBotCookie(), { status: 401 });
    await assert.rejects(auth.openBotIdentity(`better-auth.session_token=${token}`), {
      status: 401,
    });
    await assert.rejects(auth.openBotIdentity(`${cookie}; ignored=1`), { status: 401 });
    const forged = `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`;
    await assert.rejects(auth.openBotIdentity(forged), { status: 401 });
    await auth.logout(authorization);
    await assert.rejects(auth.openBotIdentity(cookie), { status: 401 });
    const otherId = createHash("sha256").update(another.token).digest("hex");
    const otherCookie = await auth.openBotCookie(`Bearer ${another.token}`);
    await db.put("system", "sessions", { id: otherId, owner: "local-user", expiresAt: Date.now() });
    await assert.rejects(auth.openBotIdentity(otherCookie), { status: 401 });
  } finally {
    await db.close();
  }
});
