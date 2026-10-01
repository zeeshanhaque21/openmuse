import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../apps/server/src/app.ts";
import { createStore } from "../../apps/server/src/db.ts";
import type { ActionProposal } from "../../packages/domain/src/index.ts";

const provider = process.argv[2];
assert.ok(
  ["claude", "codex"].includes(provider),
  "Usage: pnpm exec tsx task-smoke.ts claude|codex",
);
const directory = dirname(fileURLToPath(import.meta.url));
const dataDir = join(directory, ".runtime", provider, "task");
const resultsDir = join(directory, ".results");
await mkdir(resultsDir, { recursive: true, mode: 0o700 });
await mkdir(dataDir, { recursive: true, mode: 0o700 });
process.env.OPENMUSE_SUBSCRIPTION_SPIKE = "1";
process.env.OPENMUSE_SUBSCRIPTION_SPIKE_DATA_DIR = dataDir;
if (provider === "codex") process.env.CODEX_HOME = join(directory, ".runtime", "codex", "home");
const db = await createStore({ dataDir: join(dataDir, "db") });
const server = await createApp(db, {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir,
  agentBackend: "model",
  intelligenceApiKey: "test-project-key-never-sent",
  model: provider === "claude" ? "claude-code/subscription" : "codex/subscription",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: [],
});
const started = Date.now();
const owner = `subscription-spike-${provider}`;
let result: Record<string, unknown> = { provider, stage: "openmuse-task", status: "running" };
let diagnostics: Record<string, unknown> = {};
await writeFile(join(resultsDir, `${provider}-task.json`), `${JSON.stringify(result)}\n`, {
  mode: 0o600,
});
try {
  const task = await server.agent.createTask(owner, {
    kind: "plan",
    prompt:
      "Make a two-step weekend plan: take a walk, then read for 30 minutes. Use set_plan, save_artifact with title Subscription smoke plan and kind plan, then finish_task. No workspace reads, web requests, purchases, or external actions are needed.",
  });
  await server.agent.worker.tick();
  const detail = await server.agent.detail(owner, task.id);
  diagnostics = {
    lastUpdate: detail.task.state.lastUpdate,
    eventTitles: detail.events.map((event) => event.title),
  };
  assert.equal(detail.task.status, "succeeded", detail.task.error ?? detail.task.question);
  const artifact = detail.artifacts.find((item) => item.title === "Subscription smoke plan");
  assert.ok(artifact, "The real task must persist its plan artifact");
  assert.ok(artifact.summary.toLowerCase().includes("walk"));
  assert.ok(artifact.summary.toLowerCase().includes("read"));
  assert.ok(detail.task.artifactIds.includes(artifact.id));
  const approvalTask = await server.agent.createTask(owner, {
    prompt:
      "Prepare a calendar event titled Subscription smoke walk, starting 2026-10-10T10:00:00-07:00 and ending 2026-10-10T11:00:00-07:00. Use prepare_event and stop for user approval. Do not finish_task or claim the event was created.",
  });
  await server.agent.worker.tick();
  const pending = await server.agent.getTask(owner, approvalTask.id);
  assert.equal(pending.status, "waiting_approval", pending.error ?? pending.question);
  assert.ok(pending.actionId);
  const proposal = await db.get<ActionProposal>(owner, "actions", pending.actionId);
  assert.ok(proposal);
  assert.notEqual(proposal.status, "succeeded", "The runner must not approve its own action");
  result = {
    provider,
    stage: "openmuse-task",
    status: "passed",
    taskStatus: detail.task.status,
    artifactPersisted: true,
    planValidated: true,
    approvalStatus: pending.status,
    externalActionExecuted: false,
    durationMs: Date.now() - started,
  };
} catch (error) {
  result = {
    provider,
    stage: "openmuse-task",
    status: "failed",
    durationMs: Date.now() - started,
    error: error instanceof Error ? error.message : "Unknown task failure",
    diagnostics,
  };
  process.exitCode = 1;
} finally {
  await server.agent.stop();
  await db.close();
  await writeFile(
    join(resultsDir, `${provider}-task.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
}
