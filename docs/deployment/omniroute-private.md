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

The intended zero-new-paid-service topology is a free Render static frontend and a private persistent backend on moonscape.
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

Deployment and hosted browser validation remain pending until explicitly recorded here.
