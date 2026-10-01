# Subscription deployment feasibility results

## Outcome

Local subscription-backed OpenMuse task execution works through both official CLIs in an experimental adapter.
The hosted account/provider setup flow is not implemented and this is not deployment-ready.
No Render services were created and no hosting charges were authorized.

## Verified results

| Check | Claude Code | Codex |
| --- | --- | --- |
| Installed official CLI | 2.1.285 | 0.159.2 |
| Subscription authentication preflight | Passed | Passed with isolated CLI configuration |
| Real delegated OpenMuse plan task | Succeeded | Succeeded |
| Persisted plan artifact linked to its task | Validated | Validated |
| Separate calendar task | Waiting for owner approval | Waiting for owner approval |
| External calendar action executed | No | No |
| Native CLI runs under unprivileged Linux container user | Version/help checks passed | Version/help checks passed |
| Fresh Linux subscription login and task | Not validated | Not validated |

Task evidence came from one successful plan task and one approval-sensitive task per provider, using fictional sample data on macOS.
Failures encountered before those successful runs are documented in the [spike README](../../spikes/subscription-runners/README.md).
These runs are functional checks, not performance benchmarks or exhaustive security proofs.
The Linux checks used Debian with Node 24 on arm64; they do not establish Render's deployment-platform compatibility.
The Linux image build excluded every file except its Dockerfile and dockerignore, so no Mac credentials entered the image.

## Repository validation

- Server build passed.
- Root TypeScript validation passed.
- Biome validation passed across 135 files.
- Existing API-model regression tests passed: 13 tests.
- Full existing server/mobile test command passed: 276 tests, zero failures or skips.
- The new live subscription checks are opt-in and are not added to the ordinary test command.

The worktree reused the primary checkout's installed dependencies through symlinks without installing over them.
Dependency links, CLI auth stores, runtime databases, and raw connection credentials are not committed.

## Launch blockers

1. Complete a fresh official Linux login for each provider without exporting Mac credentials.
2. Validate actual OpenMuse tasks, approvals, cancellation, and conversational state handling on the deployment platform.
3. Prove credential/process isolation, including separation from application secrets and the other provider's credentials.
4. Implement single-owner setup, password login, secure sessions, and registration closure.
5. Implement the post-hosting provider setup page, official authorization/fallback instructions, explicit billing selection, encrypted API keys, and reconnect/disconnect/delete controls.
6. Confirm the implemented Claude hosting/authentication flow complies with provider restrictions.
7. Present the actual Render topology, measured sizing, and current recurring costs for approval before provisioning.

The experimental model strings and local-only environment gate are not a replacement for those launch conditions.
Do not merge or deploy the spike as the finished feature.

## Tracking

- [Implementation issue](https://github.com/zeeshanhaque21/openmuse/issues/1)
- [Draft feasibility PR](https://github.com/zeeshanhaque21/openmuse/pull/2)

Refs #1.
