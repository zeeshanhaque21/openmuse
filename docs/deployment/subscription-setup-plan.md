# Private Render deployment with subscription runners

## Confirmed scope

- Render-first, single-owner deployment.
- One-time owner setup, password login, secure sessions, and no public registration.
- Separate OpenMuse login and Claude/OpenAI provider connections.
- Provider connections configured after deployment through a browser-first setup page.
- Official CLI authentication fallback where browser-only authentication is unavailable.
- Explicit subscription or API-key selection for each provider.
- No automatic fallback to billable API usage.
- Encrypted API-key storage and private CLI-managed credential persistence.
- Disconnect/delete controls and separate saved, tested, expired, and rate-limited states.
- Validate a real OpenMuse task through both subscription runners before launch.
- Present exact Render services and current hosting costs for approval before provisioning.

## Feasibility gates

1. Verify installed, unmodified Claude Code and Codex binaries and their authentication modes without reading or exporting credentials.
2. Run one real delegated task per runner against OpenMuse tools, validating persisted task state and artifacts.
3. Prove approval-sensitive tools still pause for owner review.
4. Check official headless authentication and persistence on a Linux environment representative of Render.
5. Verify runners cannot access application secrets, arbitrary local files, or unrestricted host tools.
6. Confirm provider authentication policies permit the actual integration; stop if they do not.

CLI authentication status alone does not satisfy an end-to-end gate.
A local Mac success does not establish Linux or Render compatibility.
Do not provision paid services during feasibility work.

## Existing implementation constraints

`render.yaml` currently uses the model API backend and requests `OPENAI_API_KEY`.
`apps/server/src/engine/tanstack-agent.ts` currently selects API SDK adapters.
OpenMuse currently requires a separate server-side `CPK_INTELLIGENCE_API_KEY`.
The external AG-UI backend replaces conversational routing only, not delegated task execution.
An implementation must cover both conversational routing and delegated tasks without bypassing the existing tool validation and approval guards.

## Provider references

- [Codex authentication and headless device login](https://developers.openai.com/codex/auth)
- [Claude Code authentication and hosting restrictions](https://code.claude.com/docs/en/legal-and-compliance)

Claude subscription credentials must not be repurposed as generic model API credentials.
Claude Code must run unmodified with its official authentication flow.
Any provider-policy ambiguity is a blocker, not evidence of support.
