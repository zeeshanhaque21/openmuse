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

Investigation started; no OpenBot deployment or live bridge has been validated yet.
