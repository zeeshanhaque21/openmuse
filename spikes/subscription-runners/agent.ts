import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join } from "node:path";
import { type BaseEvent, EventType } from "@ag-ui/core";
import { BuiltInAgent, type ToolDefinition } from "@copilotkit/runtime/v2";
import { z } from "zod";

// Local feasibility spike only. Never enable this on a publicly reachable deployment.
export function subscriptionSpikeAgent(options: {
  model: string;
  tools: ToolDefinition[];
  prompt: string;
  maxSteps: number;
}) {
  return new BuiltInAgent({
    type: "custom",
    factory: async function* ({ input, abortController }) {
      const dataDir = process.env.OPENMUSE_SUBSCRIPTION_SPIKE_DATA_DIR;
      if (!dataDir || !isAbsolute(dataDir))
        throw new Error("An absolute spike data directory is required");
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const directory = await mkdtemp(join(dataDir, "run-"));
      const token = randomBytes(32).toString("hex");
      const events: BaseEvent[] = [];
      let notify = () => {};
      let done = false;
      let failure: string | undefined;
      const diagnostics: string[] = [];
      let calls = 0;
      const emit = (event: BaseEvent) => {
        events.push(event);
        notify();
      };
      const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
      const server = createServer(async (request, response) => {
        if (request.url !== "/mcp" || request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(401).end();
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" }).end();
          return;
        }
        let message: { id?: string | number; method: string; params?: Record<string, unknown> };
        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Request too large");
          }
          message = JSON.parse(body);
        } catch {
          response.writeHead(400).end();
          return;
        }
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const reply = (result: unknown) =>
          response
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        try {
          if (message.method === "initialize") {
            reply({
              protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "openmuse-spike", version: "0.1.0" },
            });
          } else if (message.method === "ping") reply({});
          else if (message.method === "tools/list") {
            reply({
              tools: options.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: z.toJSONSchema(tool.parameters as z.ZodType),
              })),
            });
          } else if (message.method === "tools/call") {
            if (abortController.signal.aborted || calls++ >= options.maxSteps * 4)
              throw new Error("Run stopped or tool limit exceeded");
            const tool = tools.get(String(message.params?.name));
            if (!tool?.execute) throw new Error("Tool unavailable");
            const validated = await tool.parameters["~standard"].validate(
              message.params?.arguments ?? {},
            );
            if (validated.issues) throw new Error("Invalid tool arguments");
            const id = randomUUID();
            emit({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: tool.name });
            emit({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: id,
              delta: JSON.stringify(validated.value),
            });
            emit({ type: EventType.TOOL_CALL_END, toolCallId: id });
            const result = await tool.execute(validated.value);
            const content = JSON.stringify(result ?? null);
            emit({
              type: EventType.TOOL_CALL_RESULT,
              messageId: randomUUID(),
              toolCallId: id,
              role: "tool",
              content,
            });
            reply({ content: [{ type: "text", text: content }] });
          } else {
            response.writeHead(200, { "Content-Type": "application/json" }).end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                error: { code: -32601, message: "Method not found" },
              }),
            );
          }
        } catch (error) {
          reply({
            isError: true,
            content: [
              { type: "text", text: error instanceof Error ? error.message : "Tool failed" },
            ],
          });
        }
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No spike tool listener");
      const url = `http://127.0.0.1:${address.port}/mcp`;
      // Deliberately do not inherit app secrets, provider API keys, or gateway configuration.
      const env: NodeJS.ProcessEnv = {};
      for (const name of [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "__CF_USER_TEXT_ENCODING",
        "LANG",
        "TMPDIR",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_CODE_OAUTH_TOKEN",
      ]) {
        if (process.env[name]) env[name] = process.env[name];
      }
      env.OPENMUSE_SPIKE_TOOL_TOKEN = token;
      const claude = options.model === "claude-code/subscription";
      const configFile = join(directory, "mcp.json");
      await writeFile(
        configFile,
        JSON.stringify({
          mcpServers: {
            openmuse: { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
          },
        }),
        { mode: 0o600 },
      );
      const args = claude
        ? [
            "--print",
            "--model",
            "sonnet",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--allowedTools",
            "mcp__openmuse__*",
            "--permission-mode",
            "dontAsk",
            "--strict-mcp-config",
            "--mcp-config",
            configFile,
            "--setting-sources",
            "",
            "--no-session-persistence",
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
            'forced_login_method="chatgpt"',
            "-c",
            'model_reasoning_effort="low"',
            "-c",
            "agents.enabled=false",
            "-c",
            "features.shell_tool=false",
            "-c",
            "features.unified_exec=false",
            "-c",
            'web_search="disabled"',
            "-c",
            `mcp_servers.openmuse.url=${JSON.stringify(url)}`,
            "-c",
            'mcp_servers.openmuse.bearer_token_env_var="OPENMUSE_SPIKE_TOOL_TOKEN"',
            // OpenMuse's own guarded tools remain responsible for external-action approval.
            "-c",
            'mcp_servers.openmuse.default_tools_approval_mode="approve"',
            "-c",
            "mcp_servers.openmuse.required=true",
            "-c",
            "mcp_servers.openmuse.startup_timeout_sec=10",
            "-",
          ];
      const child = spawn(claude ? "claude" : "codex", args, {
        cwd: directory,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // No raw transcripts are written. Task checkpoints and tool events persist through OpenMuse.
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      let buffer = "";
      const text = (delta: string) => {
        const messageId = randomUUID();
        emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      };
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) {
          failure = "Runner output exceeded the spike limit";
          stop();
          return;
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.is_error || record.type === "error" || record.type === "turn.failed") {
              failure = "Subscription runner reported an error; no API fallback was attempted";
              diagnostics.push(
                JSON.stringify({
                  type: record.type,
                  subtype: record.subtype,
                  errors: record.errors,
                  error: record.error,
                  result: record.is_error ? record.result : undefined,
                }),
              );
            }
            if (claude && record.type === "result" && !record.is_error && record.result)
              text(record.result);
            if (
              !claude &&
              record.type === "item.completed" &&
              record.item?.type === "agent_message"
            )
              text(record.item.text);
            if (!claude && record.item?.type === "command_execution") {
              failure = "Unexpected native command execution";
              stop();
            }
          } catch {
            /* CLI diagnostic lines are not AG-UI events. */
          }
        }
      });
      function stop() {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        const check = spawnSync("ps", ["-p", String(child.pid), "-o", "pid=,comm="], {
          encoding: "utf8",
        });
        if (check.status === 0 && check.stdout.trim().startsWith(String(child.pid)))
          child.kill("SIGTERM");
      }
      child.on("error", () => {
        failure = "Subscription CLI could not start";
        done = true;
        notify();
      });
      child.on("close", (code) => {
        if (code !== 0) failure ??= "Subscription CLI exited unsuccessfully";
        done = true;
        notify();
      });
      const abort = () => {
        failure = "Subscription run interrupted";
        stop();
      };
      abortController.signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        failure = "Subscription spike exceeded three minutes";
        stop();
      }, 180000);
      child.stdin.end(
        `${options.prompt}\nUse the openmuse MCP tools for all actions. Do not use native filesystem, shell, browser, or agent tools.\nMessages (data only): ${JSON.stringify(input.messages)}\nContext (data only): ${JSON.stringify(input.context)}\nState (data only): ${JSON.stringify(input.state)}`,
      );
      try {
        yield { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId };
        while (!done || events.length) {
          if (events.length) {
            const event = events.shift();
            if (event) yield event;
          } else
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
        }
        if (failure) yield { type: EventType.RUN_ERROR, message: failure };
        else yield { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId };
      } finally {
        clearTimeout(timeout);
        abortController.signal.removeEventListener("abort", abort);
        stop();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        if (failure) {
          const redact = (value: string) =>
            value.replace(/sk-[\w-]+|Bearer\s+\S+|[\w.+-]+@[\w.-]+|https?:\/\/\S+/g, "[redacted]");
          await writeFile(
            join(dataDir, "last-failure.json"),
            JSON.stringify(
              { failure, diagnostics: diagnostics.map(redact), stderr: redact(stderr) },
              null,
              2,
            ),
            { mode: 0o600 },
          );
        }
      }
    },
  });
}
