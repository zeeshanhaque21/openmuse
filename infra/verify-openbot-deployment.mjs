import assert from "node:assert/strict";

// Public/protected-route checks only. Never reads the owner's password or browser session.
const api = "https://moonscapenas.time-mora.ts.net:8443";
const upstream = "http://100.114.236.60:18902";
const request = (url, options = {}) =>
  fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
const healthResponse = await request(`${api}/api/health`);
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.agentBackend, "openbot");
assert.equal(health.agentConfigured, true);
assert.equal(health.browserConfigured, true);
for (const path of ["/api/models", "/api/computer", "/api/google/status", "/api/main-thread"])
  assert.equal((await request(`${api}${path}`)).status, 401, path);
assert.equal(
  (
    await request(`${api}/api/me`, {
      headers: { cookie: "better-auth.session_token=forged.invalid" },
    })
  ).status,
  401,
);
assert.equal(
  (
    await request(`${api}/api/openbot/agent/unrelated`, {
      method: "POST",
      headers: {
        "x-openmuse-bridge": "better-auth.session_token=forged.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    })
  ).status,
  401,
);
assert.equal((await request(`${upstream}/api/me`)).status, 401);
const handoff = await request(`${upstream}/api/auth/organization/session`, {
  method: "POST",
  headers: { origin: upstream, "content-type": "application/json" },
  body: JSON.stringify({ cookie: "better-auth.session_token=forged.invalid" }),
});
assert.equal(handoff.status, 401, "Upstream authority must reject forged OpenMuse credentials");
assert.equal((await request("https://openmuse-zeeshan.onrender.com/")).status, 200);
console.log(
  JSON.stringify({
    deployedBackend: health.agentBackend,
    frontend: "available",
    nativeComputer: "configured",
    protectedRoutes: "reject-unauthenticated",
    identityAuthority: "rejects-forgery",
    runtime: "validated-in-isolated-live-bridge",
    productionOwnerConversation: "pending-owner-session",
    browserReview: "pending-user-permission",
  }),
);
