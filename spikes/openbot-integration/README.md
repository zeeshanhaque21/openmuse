# OpenBot integration spike

Tracks https://github.com/zeeshanhaque21/openmuse/issues/3.
This branch depends on `feat/subscription-provider-setup` and must not replace the working deployment until the bridge is verified.

## Acceptance

- OpenMuse remains the user-facing app and owns its existing password login.
- The OpenBot runtime receives the identity of the linked owner, not a shared administrator shortcut.
- A real conversation streams through the authenticated bridge and retains history.
- Reconnect and stop operate on the same authorized conversation.
- The owner's OmniRoute model selection remains effective, with no silent model substitution.
- Computer actions preserve the appropriate authorization, policy, and approval boundary.
- Disabled, unconfigured, or failed upstream connections report unavailable.
- Provider keys, runtime keys, and upstream sessions remain server-side.
- Existing Google connections, saved data, and the Jetson computer remain intact.

## First proof

Pin the current OpenBot source and inspect its supported identity and runtime transport.
Bring up only the minimum private upstream services needed for one linked-owner conversation.
Validate a complete streamed answer and stored history before broader integration or deployment changes.
The upstream Intelligence runtime is not a raw AG-UI SSE endpoint.
Connecting directly to a shipped Bot endpoint is not proof of the full OpenBot integration.

## Non-goals

Do not migrate Gmail, Calendar, documents, or existing durable tasks to OpenBot in this first slice.
Do not introduce paid Render services, public registration, or automatic paid model fallback.
Do not resume the user's browser automation session without permission.

## Status

The isolated live spike passed against upstream commit `2e096d685ff0f18b5e80fd72e4ad71edb1d0be43`.
The server-side runtime bridge is implemented behind `AGENT_BACKEND=openbot`.
The personal production API is now configured for OpenBot; the frontend remains OpenMuse.
Production health, protected routes, upstream startup, and real authority forgery rejection passed.
An authenticated production-owner turn and hosted browser review still require the owner's session and permission to resume the browser.
See [the deployment runbook](../../docs/deployment/openbot.md) for service names, evidence limits, and rollback.

## Verified proof

- Real password-based OpenMuse owner session and persisted session store.
- Scoped, signed authority credential instead of forwarding the workspace bearer token.
- Stable deployment-specific identity with the least-privileged OpenBot `user` role.
- Upstream organization handoff, one-use ticket redemption, and identity materialization.
- Rejection of forged credentials, foreign origins, ticket replay, expired sessions, and logout-revoked sessions.
- Private upstream Bot and channel created using the linked owner's credentials.
- Real Intelligence runtime discovery, streamed OmniRoute answer containing a fresh verification code, and reconnect with stored history.
- Upstream API access rejected immediately after OpenMuse logout.

The live model was `codex/gpt-5.6-sol`, the gateway ID corresponding to OpenMuse's configured `openai/codex/gpt-5.6-sol` adapter specification.
No alternative model was selected.
The spike uses the existing CopilotKit Intelligence project key because the full OpenBot runtime requires Intelligence.
There was no paid service provisioning or fallback.
This initial spike verified one conversation only; the later integrated bridge gates below provide the broader proof.

## Reproduce

Clone the pinned upstream into ignored `artifacts/openbot-source` and install its frozen Bun lockfile.
Run `pnpm exec tsx --test tests/openbot-identity.test.ts` for local credential checks.
Run `pnpm exec tsx spikes/openbot-integration/identity-smoke.ts` for the actual upstream authentication protocol.

For the conversation smoke, copy the moonscape deployment environment into private `.openmuse/openbot-spike/source.env`.
Run `node spikes/openbot-integration/prepare.mjs` once; its exclusive writes refuse to overwrite existing configurations.
Copy only the generated `postgres.env` to the Jetson's project-local `.openmuse/openbot-spike/` directory.
The upstream environment deliberately excludes Google credentials and production application data.

Use a separate named volume and tailnet-bound port `15432` for `openbot-integration-pgvector`.
The pinned database image is `pgvector/pgvector@sha256:5c97c57367a485a8e99389548db67d441ab1a878f5492c3df04989f34ecf3c75`, which publishes ARM64.
Plain PostgreSQL does not satisfy the upstream migration's required `vector` extension.
From `artifacts/openbot-source/server`, run `bun --env-file=<absolute-project-path>/.openmuse/openbot-spike/upstream.env node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.config.ts`.
Then run `pnpm exec tsx spikes/openbot-integration/runtime-smoke.ts` from the project root.
The spike binds both local HTTP listeners to loopback, sanitizes inherited environment variables, and shuts down its child API on exit.
Its logs and result receipt remain private under `.openmuse/openbot-spike/`.
It creates a fresh isolated owner and private Bot on each run; it is not a batch benchmark or a cleanup script.
The Jetson test database is stopped after the successful proof, with its named volume retained.
Run `docker start openbot-integration-pgvector` on the Jetson before another conversation smoke.
The earlier plain-PostgreSQL attempt is retained as the stopped `openbot-integration-postgres` container, not used by the proof.

## Remaining owner validation

- With permission to resume the hosted browser, send one owner-authenticated production turn and inspect the rendered reply, model picker, history, and Stop/reconnect interaction.
- Verify PR evidence rendering in the logged-in browser without taking over the user's browser task space.

## Completed bridge gates

`bridge-smoke.ts --computer` passed the actual OpenMuse runtime, upstream runtime, private Bot callback, and existing OmniRoute gateway.
It verified two selected Codex models from the catalog without substitution, saved selection after restart, local history restore, stable upstream channel identity, unauthorized-thread refusal, and logout revocation.
The model used the real native computer tools to write and read a Jetson workspace file, which survived terminal restart.
The final complete `--computer` gate also verified that Stop reaches the native model stream, followed by reconnect and a new reply on the same thread.
Its delayed model stream is a deterministic cancellation fixture, not a model-quality or performance measurement.
The final full repository suite passed 283 tests; the focused owner/identity/bridge regression passed 5 tests, and lint and both TypeScript gates passed.

OpenBot's linked Bots are remote agents calling OpenMuse's native agent, so model-picker synchronization and computer/Google approval policy reuse the existing responsible layers.
The upstream receives no OmniRoute model key or Google credentials.
There are no upstream built-in Bots, computer workers, or independent provider fallbacks in the personal tenant.
Intelligence event envelopes must be stripped before relaying them into a second runtime; forwarding `cpki_ingested` and event IDs corrupts outer event durability.
The inner runner has its own run ID, while protocol events are remapped to the authorized local thread/run.
Explicit stop propagation must complete before its websocket is closed; unsubscribing first can discard the buffered stop request.
