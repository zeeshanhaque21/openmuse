import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("single owner setup protects the HTTP workspace, persists across restart, and revokes logout", async () => {
  await mkdir(resolve("spikes/subscription-runners/.runtime"), { recursive: true });
  const directory = await mkdtemp(resolve("spikes/subscription-runners/.runtime/owner-auth-"));
  const config: Config = {
    mode: "live",
    host: "127.0.0.1",
    port: 8787,
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    ownerSetupKey: "test-only-setup-code-long-enough",
    accessKey: "old-key-must-not-bypass-password",
    agentBackend: "model",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  let db = await createStore({ dataDir: join(directory, "db") });
  let server = await createApp(db, config);
  const password = "test-only-owner-password-123";
  const request = (body: unknown) =>
    server.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    assert.deepEqual(await (await server.app.request("/api/auth/status")).json(), {
      method: "password",
      setupRequired: true,
    });
    assert.equal((await server.app.request("/api/workspace")).status, 401);
    assert.equal((await request({ accessKey: config.accessKey })).status, 401);
    assert.equal((await request({ setupKey: "wrong", password })).status, 401);
    assert.equal(
      (await request({ setupKey: config.ownerSetupKey, password: "short" })).status,
      400,
    );
    const responses = await Promise.all([
      request({ setupKey: config.ownerSetupKey, password }),
      request({ setupKey: config.ownerSetupKey, password }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const created = await responses.find((response) => response.status === 200)?.json();
    assert.ok(created.token);
    const authorization = { Authorization: `Bearer ${created.token}` };
    assert.equal(
      (await server.app.request("/api/workspace", { headers: authorization })).status,
      200,
    );
    assert.equal((await request({ accessKey: config.accessKey })).status, 401);
    assert.equal((await request({ password: "incorrect password" })).status, 401);
    const stored = await db.get<{ salt: string; passwordHash: string }>(
      "system",
      "accounts",
      "owner",
    );
    assert.ok(stored?.salt && stored.passwordHash);
    assert.ok(!JSON.stringify(stored).includes(password));
    await server.agent.stop();
    await db.close();
    db = await createStore({ dataDir: join(directory, "db") });
    server = await createApp(db, config);
    assert.deepEqual(await (await server.app.request("/api/auth/status")).json(), {
      method: "password",
      setupRequired: false,
    });
    assert.equal((await request({ setupKey: config.ownerSetupKey, password })).status, 409);
    const signedIn = await request({ password });
    assert.equal(signedIn.status, 200);
    const session = await signedIn.json();
    const headers = { Authorization: `Bearer ${session.token}` };
    assert.equal((await server.app.request("/api/auth/status", { headers })).status, 200);
    assert.equal(
      (
        await server.app.request("/api/auth/status", {
          headers: { Authorization: "Bearer forged" },
        })
      ).status,
      401,
    );
    assert.equal((await server.app.request("/api/workspace", { headers })).status, 200);
    assert.equal(
      (await server.app.request("/api/session", { method: "DELETE", headers })).status,
      200,
    );
    assert.equal((await server.app.request("/api/workspace", { headers })).status, 401);
    assert.equal((await server.app.request("/api/auth/status", { headers })).status, 401);
    assert.equal(
      (await server.app.request("/api/session", { method: "DELETE", headers })).status,
      401,
    );
  } finally {
    await server.agent.stop();
    await db.close();
  }
});
