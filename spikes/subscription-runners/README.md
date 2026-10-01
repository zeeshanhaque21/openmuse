# Subscription runner feasibility spike

This is not a production provider adapter or a hosted authentication implementation.
Do not enable `OPENMUSE_SUBSCRIPTION_SPIKE` on a publicly reachable deployment.

## Local checks

Use installed, official Claude Code and Codex CLIs already signed into subscriptions.
Run sequentially from the repository root:

```sh
node spikes/subscription-runners/probe.mjs claude
node spikes/subscription-runners/probe.mjs codex
node --import tsx spikes/subscription-runners/task-smoke.ts claude
node --import tsx spikes/subscription-runners/task-smoke.ts codex
```

The authentication probes validate an exact reply, not an OpenMuse task.
The task smoke tests create a real delegated task, run OpenMuse's worker, validate the persisted plan artifact, and verify a separate calendar request waits for owner approval.
They use fictional sample data and do not execute an external action.
They do not validate the web interface, hosted login, reconnect behavior, or Linux task execution.

Summaries are written under `.results/` and persistent test databases under `.runtime/`.
Both directories are excluded from Git and Biome.
Do not commit, lint, format, archive, or upload CLI credential stores.
Codex's isolated home links to its existing local auth cache without reading or copying token bytes.
The production implementation must establish a fresh official login on its host instead.

## Observed failure boundaries

- Codex's existing user configuration included 13 MCP servers and selected OmniRoute.
  Overriding the provider and setting `mcp_servers={}` did not yield a response within the probe's 90-second deadline.
  An isolated `CODEX_HOME`, using the official ChatGPT auth cache and no user configuration, completed the same probe.
- A minimal Claude child environment failed with an OAuth refresh error.
  Preserving the standard `USER`, `LOGNAME`, and `__CF_USER_TEXT_ENCODING` variables made the actual task succeed.
  The individual variable responsible has not been isolated.
- Codex's default noninteractive tool approval policy blocked OpenMuse MCP tools.
  Explicit approval for this one private MCP server allowed the task, while OpenMuse's own calendar approval guard still paused the external action.
- The repository's pnpm pre-run dependency check attempted to reinstall a symlinked dependency tree.
  Do not permit a worktree install to purge the primary checkout's dependencies.
  For this spike, invoke the installed TypeScript/Biome binaries directly and use `node --import tsx`.

## Linux CLI compatibility check

```sh
docker build -t openmuse-subscription-spike:local spikes/subscription-runners
docker run --rm openmuse-subscription-spike:local claude --version
docker run --rm openmuse-subscription-spike:local codex --version
docker run --rm openmuse-subscription-spike:local codex login --help
docker run --rm openmuse-subscription-spike:local claude auth login --help
```

The build context contains only the Dockerfile and dockerignore, never local credentials or application data.
Version/help checks establish binary compatibility only.
A real Linux subscription task requires a fresh user-authorized login and separate persisted credential storage.

## Remaining launch gates

- Fresh official Linux authentication for both providers.
- Linux OpenMuse task and approval smoke tests.
- Isolation of runner credentials from application secrets and other provider credentials.
- Password-based owner setup and secure sessions.
- Browser-first provider connection, explicit billing-mode selection, encrypted API keys, reconnect, and disconnect/delete controls.
- Conversational routing, state events, cancellation, and error behavior.
- Confirmed permitted provider authentication and hosting flows.
- Exact Render service sizing and current cost approval before provisioning.
