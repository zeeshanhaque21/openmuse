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
The production deployment is unchanged; this branch does not enable OpenBot in the hosted UI.

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
This verifies one conversation, not production deployment, runtime switching, arbitrary catalog models, stopping an active run, or computer policy.

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

## Remaining integration gates

- Mount the identity authority only for configured upstream connections, without widening workspace authentication.
- Keep upstream credentials and Intelligence metadata on the OpenMuse server while relaying streams to the native client.
- Bind local conversations to authorized upstream channels; test unauthorized thread IDs and cross-deployment credentials.
- Keep the saved OmniRoute picker selection effective for every upstream run rather than using a process-static `BOT_MODEL`.
- Prove active-run stop, disconnect/reconnect, and service-restart behavior.
- Preserve approval and computer boundaries before granting any upstream tools.
- Deploy only after the complete bridge passes those gates; leave the native agent active until then.
