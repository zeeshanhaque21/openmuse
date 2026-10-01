# Personal deployment with OmniRoute

The deployment now uses the existing OmniRoute on moonscape, not separate Claude/Codex CLI runners.
This supersedes the earlier subscription-setup design.

## Model selection

OpenMuse loads the authenticated `/v1/models` catalog through its backend.
Choose any catalog entry under Apps > Model · OmniRoute.
The selected model is persisted in the application database and used for conversation and delegated tasks.
The gateway API key never goes to the browser.
OpenMuse does not substitute a different model after an error.
OmniRoute combos may have their own fallback and billing rules; selecting a combo does not disable those rules.
Catalog presence does not prove a model is currently authenticated, healthy, free, or compatible with agent tool calls.

## Hosting

The deployed topology is a free Render static frontend and a private persistent backend on moonscape.
The backend is reachable through Tailscale HTTPS, so the browser must be on the tailnet.
The existing OmniRoute HTTPS service on port 443 must remain unchanged.
Provider sign-in and API-key management remain in OmniRoute.
OpenMuse has its own separate one-time owner setup and password login.

## Verified so far

- Owner setup, password login, invalid-password rejection, and logout passed through the actual exported web UI.
- An HTTP test verifies atomic single-owner setup and account persistence through a database restart.
- The gateway model catalog and selection HTTP test passed, including arbitrary provider IDs, secret exclusion, restart restoration, and failure without model substitution.
- A real OpenMuse task through `codex/gpt-5.6-sol` on moonscape OmniRoute saved a validated plan artifact.
- A separate gateway-backed calendar request stopped at owner approval without executing an external action.

## Deployment state

- Frontend: https://openmuse-zeeshan.onrender.com/
- Private API: https://moonscapenas.time-mora.ts.net:8443
- Render static service: `srv-daurmkbncjis7382i11g`.
- Render deploy `dep-daurmkrncjis7382i1t0` succeeded from commit `2606f6f`.
- Backend: Docker container `openmuse-personal`, image `openmuse-personal:jetson-cf855db`, unprivileged user, read-only root filesystem, private loopback listener, and restart policy.
- Backend data: `/home/moonscape/projects/OpenMuse-subscription-setup/.openmuse/data`.
- Backend health and owner-setup status returned HTTP 200 through Tailscale HTTPS.
- Private workspace and model catalog returned HTTP 401 without a session.
- No paid Render web services, disks, or databases were created.
- Existing OmniRoute installation and its HTTPS port 443 are unchanged.

The host kernel reported that Docker's requested memory limit could not be enforced.
The container's 2 GB memory setting must not be reported as an effective limit.
Browser and computer services are now deployed on the Jetson and connected to the backend.
See [Jetson computer deployment](jetson-computer.md) for boundaries, evidence, and operational details.

The owner account is now set up and remained present after the Google configuration restart.
The one-time code is stored privately under `.openmuse/owner-setup-code.txt` on moonscape.
The user took control of the browser before the hosted UI check, so that check and hosted model-picker interaction remain pending.
Local browser and HTTP tests do not replace that hosted validation.

## Google configuration

The user-provided Google Web application OAuth client is now configured on the backend.
Its registered redirect URI matches `https://moonscapenas.time-mora.ts.net:8443/api/google/callback`.
The existing encryption key, owner setup key, gateway key, and persistent data directory were preserved.
OpenMuse was recreated with the updated environment; the old stopped container is retained for rollback.
Runtime verification confirmed `GoogleAuth.configured()` is true and token encryption/decryption works with the existing key.
Public health checks returned HTTP 200 and owner setup remained complete after restart.
The user confirmed Google connection succeeded after adding their account as a tester and enabling the Google APIs.
That confirmation is user-reported, not an independently repeated consent-flow test.

## Validation notes

Focused owner/model HTTP and regression tests passed: 8 tests.
Server, mobile, and spike TypeScript checks passed.
A later full-suite attempt hit the 120-second harness deadline with 271 passing tests and one cancelled Jev persistence file.
Do not report that attempt as a full-suite pass.
The subsequent full-suite run with four concurrent test files and a 240-second budget passed all 278 tests, with zero failures, cancellations, or skips.

Refs #1.
