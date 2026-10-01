import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

test("gateway catalog is private, supports any catalog model, persists selection, and never substitutes on failure", async () => {
  const secret = "test-gateway-key-never-exposed";
  let available = true;
  const upstream = createServer((req, res) => {
    assert.equal(req.url, "/v1/models");
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    if (!available) {
      res.writeHead(503).end();
      return;
    }
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(
        JSON.stringify({
          data: [
            { id: "codex/arbitrary-model" },
            { id: "claude/arbitrary-model" },
            { id: "local/custom-model" },
            { id: "combo-with-user-rules" },
            { id: "local/custom-model" },
            { id: "bad\nmodel" },
          ],
        }),
      );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const db = await createStore();
  const directory = await mkdtemp(join(tmpdir(), "openmuse-model-settings-"));
  const config: Config = {
    mode: "sample",
    host: "127.0.0.1",
    port: 8787,
    publicUrl: "http://localhost:8787",
    dataDir: directory,
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
    modelGatewayUrl: `http://127.0.0.1:${address.port}/v1`,
    modelGatewayKey: secret,
  };
  let server = await createApp(db, config);
  try {
    assert.equal((await server.app.request("/api/models")).status, 401);
    const session = await (
      await server.app.request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).json();
    const headers = {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
    };
    const catalog = await (await server.app.request("/api/models", { headers })).json();
    assert.deepEqual(catalog.models, [
      "claude/arbitrary-model",
      "codex/arbitrary-model",
      "combo-with-user-rules",
      "local/custom-model",
    ]);
    assert.ok(!JSON.stringify(catalog).includes(secret));
    for (const modelId of catalog.models) {
      const selected = await server.app.request("/api/models/selection", {
        method: "POST",
        headers,
        body: JSON.stringify({ modelId }),
      });
      assert.equal(selected.status, 200);
      assert.equal(config.model, `openai/${modelId}`);
    }
    assert.equal(
      (
        await server.app.request("/api/models/selection", {
          method: "POST",
          headers,
          body: JSON.stringify({ modelId: "not-in-catalog" }),
        })
      ).status,
      422,
    );
    assert.equal(config.model, "openai/local/custom-model");
    await server.agent.stop();
    const restoredConfig = { ...config, model: "openai/should-not-replace-selection" };
    server = await createApp(db, restoredConfig);
    assert.equal(restoredConfig.model, "openai/local/custom-model");
    available = false;
    assert.equal((await server.app.request("/api/models", { headers })).status, 503);
    assert.equal(restoredConfig.model, "openai/local/custom-model");
    await assert.rejects(
      createApp(db, { ...config, modelGatewayKey: undefined }),
      /No direct-provider fallback/,
    );
  } finally {
    await server.agent.stop();
    await db.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
