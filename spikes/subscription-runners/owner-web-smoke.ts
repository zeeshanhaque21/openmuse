import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "../../apps/server/src/app.ts";
import { createStore } from "../../apps/server/src/db.ts";

// Local, fictional-data browser fixture. Never deploy this smoke server.
await mkdir(resolve("spikes/subscription-runners/.runtime"), { recursive: true });
const dataDir = await mkdtemp(resolve("spikes/subscription-runners/.runtime/owner-web-"));
const db = await createStore({ dataDir });
const server = await createApp(db, {
  mode: "sample",
  host: "127.0.0.1",
  port: 8789,
  publicUrl: "http://localhost:8789",
  dataDir,
  ownerSetupKey: "fictional-local-smoke-setup-code",
  agentBackend: "sample",
  intelligenceApiKey: "test-project-key-never-sent",
  googleRedirectUri: "http://localhost:8789/api/google/callback",
  allowedOrigins: ["http://localhost:8790"],
});
const staticApp = new Hono();
staticApp.use("*", serveStatic({ root: "apps/mobile/dist/web" }));
const api = serve({ fetch: server.app.fetch, hostname: "127.0.0.1", port: 8789 });
const web = serve({ fetch: staticApp.fetch, hostname: "127.0.0.1", port: 8790 });
console.log(
  JSON.stringify({
    pid: process.pid,
    url: "http://localhost:8790",
    fixture: "fictional-owner-setup",
  }),
);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    api.close();
    web.close();
    await server.agent.stop();
    await db.close();
    process.exit(0);
  });
}
