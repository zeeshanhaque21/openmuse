import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Authentication preflight only. A successful response is NOT an OpenMuse task smoke test.
const directory = dirname(fileURLToPath(import.meta.url));
const provider = process.argv[2];
assert.ok(["claude", "codex"].includes(provider), "Usage: node probe.mjs claude|codex");
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(ANTHROPIC_|OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|CLAUDE_CODE_USE_)/.test(key)) {
    delete env[key];
  }
}
delete env.CLAUDECODE;
delete env.CLAUDE_CODE_BARE;
// Keep official CLI-managed credentials and CLAUDE_CODE_OAUTH_TOKEN, never API billing.
const prompt = "Reply with exactly OPENMUSE_SUBSCRIPTION_OK. Do not use any tools.";
const args =
  provider === "claude"
    ? [
        "--print",
        "--model",
        "sonnet",
        "--output-format",
        "json",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--setting-sources",
        "",
        "--no-session-persistence",
        prompt,
      ]
    : [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "-c",
        'model_provider="openai"',
        "-c",
        "mcp_servers={}",
        "-c",
        "agents.enabled=false",
        "-c",
        'model_reasoning_effort="low"',
        prompt,
      ];
const runtime = join(directory, ".runtime", provider);
await mkdir(runtime, { recursive: true, mode: 0o700 });
if (provider === "codex") {
  // Isolate the probe from user MCP servers, gateways, hooks, and repository instructions.
  // The official CLI reads its own existing auth cache; this probe never reads token bytes.
  const authCache = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  const isolatedHome = join(runtime, "home");
  await mkdir(isolatedHome, { recursive: true, mode: 0o700 });
  const link = join(isolatedHome, "auth.json");
  const existing = await lstat(link).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!existing) await symlink(authCache, link);
  else assert.ok(existing.isSymbolicLink(), "Refusing to overwrite a credential file");
  env.CODEX_HOME = isolatedHome;
  const status = spawnSync("codex", ["login", "status"], { env, encoding: "utf8" });
  assert.ok(
    status.status === 0 && /Logged in using ChatGPT/.test(status.stdout + status.stderr),
    "Subscription preflight requires a ChatGPT-authenticated official CLI",
  );
}
await mkdir(join(directory, ".results"), { recursive: true, mode: 0o700 });
const resultPath = join(directory, ".results", `${provider}-preflight.json`);
const started = Date.now();
const child = spawn(provider, args, { cwd: runtime, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let stderr = "";
let timedOut = false;
child.stdout.on("data", (chunk) => {
  output = (output + chunk).slice(-131072);
});
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-16384);
});
const save = (result) =>
  writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
await save({ provider, stage: "authentication-preflight", status: "running", pid: child.pid });
const timeout = setTimeout(async () => {
  timedOut = true;
  await save({
    provider,
    stage: "authentication-preflight",
    status: "timeout",
    durationMs: Date.now() - started,
  });
  // Verify the exact child immediately before termination; no broad process matching.
  const check = spawnSync("ps", ["-p", String(child.pid), "-o", "pid=,comm="], {
    encoding: "utf8",
  });
  if (check.status === 0 && check.stdout.trim().startsWith(String(child.pid)))
    child.kill("SIGTERM");
}, 90000);
const exit = await new Promise((resolve) => {
  child.once("error", () => resolve({ code: null, spawnError: true }));
  child.once("close", (code) => resolve({ code, spawnError: false }));
});
clearTimeout(timeout);
const records = output.split("\n").flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});
const text =
  provider === "claude"
    ? records
        .filter((r) => r.type === "result")
        .map((r) => r.result ?? "")
        .join("\n")
    : records
        .filter((r) => r.type === "item.completed" && r.item?.type === "agent_message")
        .map((r) => r.item.text ?? "")
        .join("\n");
const failed = records.some((r) => r.is_error || r.type === "error" || r.type === "turn.failed");
const toolUse = records.some((r) => /command_execution|mcp_tool_call/.test(r.item?.type ?? ""));
const success =
  !timedOut && exit.code === 0 && !failed && !toolUse && text.trim() === "OPENMUSE_SUBSCRIPTION_OK";
// Classify failure without writing credentials, raw CLI transcripts, or personal account details.
const combined = `${output}\n${stderr}`;
const reason = success
  ? null
  : timedOut
    ? "timeout"
    : /usage_limit_reached|usage limit|rate.limit|hit your limit/i.test(combined)
      ? "subscription-limit"
      : /401|unauthorized|not logged in|authentication|login required|invalid.*token/i.test(
            combined,
          )
        ? "authentication"
        : /403|forbidden|access.denied/i.test(combined)
          ? "access-denied"
          : exit.spawnError
            ? "binary-unavailable"
            : toolUse
              ? "unexpected-tool-use"
              : "unexpected-response";
const result = {
  provider,
  stage: "authentication-preflight",
  status: success ? "passed" : "failed",
  exitCode: exit.code,
  durationMs: Date.now() - started,
  reason,
  expectedResponseMatched: text.trim() === "OPENMUSE_SUBSCRIPTION_OK",
  toolUse,
  apiEnvironmentRemoved: true,
  openMuseTaskValidated: false,
  recordTypes: [...new Set(records.map((record) => record.type))],
  failureSignals: [
    ...new Set(
      combined.match(/401|403|429|usage_limit_reached|expired|MCP startup|reconnecting/gi) ?? [],
    ),
  ],
};
await save(result);
console.log(JSON.stringify(result));
process.exitCode = success ? 0 : 1;
