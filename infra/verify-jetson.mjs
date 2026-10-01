import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { ComputerService } from "/app/dist/apps/server/src/computer.js";
import { readConfig } from "/app/dist/apps/server/src/config.js";
import { createStore } from "/app/dist/apps/server/src/db.js";

const config = readConfig();
const db = await createStore({ dataDir: "/tmp/jetson-smoke-db" });
const computer = new ComputerService(db, config);
const owner = `deployment-smoke-${randomUUID()}`;
const session = randomUUID();
const request = async (path, body, authorized = true) => {
  const response = await fetch(`${config.workerUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(authorized ? { Authorization: `Bearer ${config.workerToken}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  return response;
};
try {
  assert.equal((await request("/sessions", undefined, false)).status, 401);
  const created = await request("/sessions", { id: session, url: "https://example.com" });
  assert.equal(created.status, 201, await created.clone().text());
  const read = await request(`/sessions/${session}/read`);
  assert.equal(read.status, 200);
  const page = await read.json();
  assert.match(page.text, /documentation examples/);
  const screenshot = await request(`/sessions/${session}/screenshot`);
  assert.equal(screenshot.status, 200);
  const png = Buffer.from(await screenshot.arrayBuffer());
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1280);
  assert.equal(png.readUInt32BE(20), 800);
  await writeFile("/evidence/jetson-browser.png", png, { flag: "wx" });
  const blocked = await request(`/sessions/${session}/navigate`, { url: "http://127.0.0.1" });
  assert.equal(blocked.status, 400);
  assert.equal((await computer.start(owner)).status, "running");
  const command = await computer.execute(owner, {
    command: "python3 -c 'import platform; print(platform.machine())'",
  });
  assert.equal(command.exitCode, 0);
  assert.match(command.stdout, /aarch64/);
  const text = "OpenMuse Jetson persistent workspace verified\n";
  await computer.write(owner, "/workspace/deployment-check.txt", text);
  assert.equal((await computer.read(owner, "/workspace/deployment-check.txt")).text, text);
  assert.equal((await computer.snapshot(owner)).status, "running");
  await computer.stop(owner);
  assert.equal((await computer.start(owner)).status, "running");
  assert.equal((await computer.read(owner, "/workspace/deployment-check.txt")).text, text);
  const snapshot = await computer.snapshot(owner);
  assert.ok(
    snapshot.commands.some((receipt) => receipt.id === command.id && receipt.exitCode === 0),
  );
  const proof = {
    browser: {
      title: page.title,
      screenshot: "jetson-browser.png",
      privateUrlsBlocked: true,
      authenticationRequired: true,
      session,
    },
    computer: {
      architecture: command.stdout.trim(),
      persistentFiles: true,
      commandReceiptSaved: true,
      workspace: snapshot.workspacePath,
      owner,
    },
  };
  await writeFile("/evidence/jetson-smoke.json", `${JSON.stringify(proof, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(JSON.stringify(proof));
} finally {
  if ((await computer.snapshot(owner)).status === "running") await computer.stop(owner);
  await request(`/sessions/${session}/close`, {});
  await db.close();
}
