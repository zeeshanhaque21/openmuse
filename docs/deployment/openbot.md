# Personal OpenBot integration

Tracks https://github.com/zeeshanhaque21/openmuse/issues/3 and draft https://github.com/zeeshanhaque21/openmuse/pull/4.

## Deployed topology

OpenMuse remains at https://openmuse-zeeshan.onrender.com/ on the existing free Render frontend.
The private API is https://moonscapenas.time-mora.ts.net:8443 and requires Tailscale access.
Moonscape runs `openmuse-personal` using `openmuse-personal:openbot-e99d079`.
Jetson runs `openbot-personal` using `openbot-personal:2e096d6-f0a27de` on tailnet-only port `18902`.
Its private PostgreSQL container is `openbot-personal-db`, with persistent volume `openbot-personal-data` and no published database port.
The upstream source is pinned to `2e096d685ff0f18b5e80fd72e4ad71edb1d0be43`.
Existing Jetson `openmuse-engine` and `openmuse-browser` are unchanged.
No paid Render service or automatic provider fallback was added.
The frontend was manually deployed on Render at commit `e99d07906fd5b1c447d2bbae061198dccef996b3` to include the connection-status fix.
Render disables auto-deploy for a specific-commit deployment, so the older configured `feat/subscription-provider-setup` branch cannot silently restore the stale status screen.

## Identity and policy

OpenMuse retains its existing single-owner password, sessions, saved data, Google connection, and model settings.
OpenBot uses deployment-bound scoped credentials derived from a valid OpenMuse session, not the owner's workspace bearer token or a shared administrator identity.
It owns private Bots and channels linked to authorized local conversation IDs.
Each Bot calls the OpenMuse native agent through its restricted callback route.
OpenMuse selects the model from the saved OmniRoute catalog setting for every native run and owns all computer/Google authorization and approval policy.
The upstream tenant has no built-in model Bots or computer worker, and receives no OmniRoute, Google, or Docker credential.
It uses the existing CopilotKit Intelligence project key for its runtime.
Already-ingested Intelligence metadata is removed at the relay boundary before native runtime ingestion.

## Network and storage

The Jetson OpenBot container uses `--add-host moonscapenas.time-mora.ts.net:100.84.236.110` because Docker's embedded DNS could not resolve the tailnet hostname.
This preserves hostname-based HTTPS certificate verification; it does not disable TLS.
If moonscape's tailnet address changes, verify the new address with `tailscale ip -4`, test an isolated container's HTTPS request, and recreate OpenBot with the updated mapping.
The upstream container uses the `openbot-personal` Docker network and `100.114.236.60:18902:3001` port mapping.
It has a read-only root filesystem, temporary `/tmp`, no added Linux capabilities, and `no-new-privileges`.
Private environments are retained under `/mnt/data/projects/OpenMuse-computer/.openmuse/openbot-personal/` on Jetson.
Moonscape retains its existing `.openmuse/data` and read-only Docker TLS mounts.
Its updated `.openmuse/deploy.env` has an exclusive backup at `.openmuse/deploy.env.before-openbot-1790885985991-1`.
Moonscape's kernel reported that Docker memory limits are unsupported; the requested API memory cap is not an enforced isolation boundary.

## Validation and limits

Run `node infra/verify-openbot-deployment.mjs` from this project for health, configured backend, protected-route rejection, real upstream authority forgery rejection, and frontend availability.
The deployed route checks passed after the explicit tailnet hostname mapping was installed.
The isolated full `bridge-smoke.ts --computer` passed real streamed answers through both runtimes and OmniRoute, two selected catalog models without substitution, model persistence, API restart, saved history, stable channel mapping, and unauthorized-thread/logout rejection.
It also passed model-driven Jetson file write/read and workspace persistence across computer restart.
Stop propagated to a deterministic delayed model stream, followed by reconnect and a fresh reply on the same conversation.
The delayed stream tests cancellation, not model quality or performance.
Private result receipts and logs are under `.openmuse/openbot-spike/`; they are not committed because they may contain account or session data.
These isolated tests are not an authenticated production-owner conversation.
The final production-owner conversation and visual review remain pending the owner's browser sign-in.
The user authorized a new browser task space after the old one no longer existed.
Task space `30` is handed to the user at the OpenMuse login screen; sign-in is required before completing the visual and authenticated-owner checks.
No password was read or requested in chat.

## Connection-status fix

The reported warning was reproduced with an authenticated `/api/workspace` test: it returned `openbotConfigured: false` while `AGENT_BACKEND=openbot` was enabled.
Both the workspace response and the Connections screen had hardcoded adapter-only placeholders.
The workspace now derives OpenBot configuration from the enabled backend and upstream URL, and the screen uses that existing runtime flag for its row, description, and status.
The wording says configured, not live health-checked, because configuration does not guarantee upstream availability.
Regression tests cover both enabled OpenBot and native/sample mode with an unused OpenBot URL.
All 285 repository tests passed after the fix; lint and both TypeScript checks passed.
A full-suite run also exposed a fake-Docker CLI startup exceeding its three-second fixture timeout.
Successful fixture commands now allow 30 seconds under full-suite contention, while the explicit hanging-process test still uses a 100-millisecond timeout.

## Rollback

The native API is retained as stopped `openmuse-personal-before-openbot` with its original environment and image.
Never run it concurrently with `openmuse-personal`; both mount the same embedded database.
Before rollback, inspect both containers and verify their images, states, and data mounts.
Stop `openmuse-personal` with a 60-second timeout and verify it exited cleanly before starting `openmuse-personal-before-openbot`.
Then confirm `/api/health` is healthy and the original protected routes still reject unauthenticated requests.
For a persistent configuration rollback, restore only the verified pre-OpenBot environment backup after checking the current file; retain the updated file as a separately named backup.
Do not delete the upstream database, volume, or existing Jetson worker services.
The stopped `openbot-personal-before-dns` container is retained as network-configuration evidence, not an active service.
The prior integrated API is also retained as stopped `openmuse-personal-before-status-e99d079` for rollback of the status-only change.
