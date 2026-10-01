import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createApp } from "/app/dist/apps/server/src/app.js";
import { readConfig } from "/app/dist/apps/server/src/config.js";
import { createStore } from "/app/dist/apps/server/src/db.js";

// Exercise the real authenticated API against Jetson workers, without touching the owner's database.
const config = {
  ...readConfig(),
  dataDir: "/tmp/http-check",
  computerDeploymentId: `http-check-${randomUUID()}`,
};
const db = await createStore({ dataDir: "/tmp/http-check/postgres" });
const { app, auth, computer } = await createApp(db, config);
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await app.fetch(
      new Request(`http://127.0.0.1${request.url}`, {
        method: request.method,
        headers: request.headers,
        ...(!["GET", "HEAD"].includes(request.method) ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(500);
    response.end("Verification request failed");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const { token } = await auth.setup(config.ownerSetupKey, randomUUID() + randomUUID());
const call = async (path, body) => {
  const result = await fetch(`${url}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(result.ok, `${path}: ${result.status} ${await result.clone().text()}`);
  return result;
};
let browser;
try {
  assert.equal((await fetch(`${url}/api/computer`)).status, 401);
  assert.equal((await (await call("/api/computer/start", {})).json()).status, "running");
  const command = await (
    await call("/api/computer/commands", { command: "pwd && python3 --version" })
  ).json();
  assert.equal(command.exitCode, 0);
  assert.match(command.stdout, /\/workspace/);
  const text = "Jetson HTTP workspace check\n";
  await call("/api/computer/files/write", { path: "/workspace/http-check.txt", text });
  assert.equal(
    (await (await call("/api/computer/files/read", { path: "/workspace/http-check.txt" })).json())
      .text,
    text,
  );
  await call("/api/computer/stop", {});
  await call("/api/computer/start", {});
  assert.equal(
    (await (await call("/api/computer/files/read", { path: "/workspace/http-check.txt" })).json())
      .text,
    text,
  );
  browser = await (await call("/api/browsers", { url: "https://example.com" })).json();
  const page = await (await call(`/api/browsers/${browser.id}/read`)).json();
  assert.match(page.text, /documentation examples/);
  const screenshot = Buffer.from(
    await (await call(`/api/browsers/${browser.id}/preview`)).arrayBuffer(),
  );
  assert.equal(screenshot.toString("hex", 0, 8), "89504e470d0a1a0a");
  console.log(
    JSON.stringify({
      authenticatedHttpApi: true,
      unauthenticatedRejected: true,
      terminalCommand: true,
      fileReadWrite: true,
      filesSurviveRestart: true,
      browserRead: true,
      browserPreview: true,
      productionDatabaseUntouched: true,
    }),
  );
} finally {
  if ((await computer.snapshot("local-user")).status === "running")
    await call("/api/computer/stop", {});
  if (browser) await call(`/api/browsers/${browser.id}/close`, {});
  await auth.logout(`Bearer ${token}`);
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
