import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAuth } from "../../apps/server/src/auth.ts";
import type { Config } from "../../apps/server/src/config.ts";
import { createStore } from "../../apps/server/src/db.ts";
import { AppError } from "../../apps/server/src/errors.ts";
// Deliberately exercise the pinned upstream implementation, not a mocked protocol.
import { createOrganizationAuth } from "../../artifacts/openbot-source/server/src/auth/organization.ts";

await mkdir(resolve(".openmuse/test"), { recursive: true });
const dataDir = await mkdtemp(resolve(".openmuse/test/openbot-upstream-"));
const db = await createStore({ dataDir: resolve(dataDir, "db") });
const config: Config = {
  mode: "live",
  host: "127.0.0.1",
  port: 0,
  publicUrl: "http://127.0.0.1",
  dataDir,
  ownerSetupKey: "upstream-test-setup-code",
  agentBackend: "model",
  intelligenceApiKey: "test-key-unused-in-identity-smoke",
  googleRedirectUri: "http://127.0.0.1/api/google/callback",
  allowedOrigins: [],
};
const auth = await createAuth(db, config);
const authority = new Hono();
authority.get("/api/me", async (c) => c.json(await auth.openBotIdentity(c.req.header("cookie"))));
authority.onError((error, c) =>
  c.json({ error: error.message }, error instanceof AppError ? error.status : 500),
);
const server = serve({ fetch: authority.fetch, hostname: "127.0.0.1", port: 0 });
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const authorityUrl = `http://127.0.0.1:${address.port}`;
const upstream = createOrganizationAuth({ authorityUrl, materializeUser: async (user) => user });
const upstreamUrl = "http://127.0.0.1:18902";
const handoff = `${upstreamUrl}/api/auth/organization/session`;
try {
  const session = await auth.setup(config.ownerSetupKey ?? "", "upstream-test-password-123");
  const cookie = await auth.openBotCookie(`Bearer ${session.token}`);
  const makeHandoff = (origin: string, value: string) =>
    upstream.handler(
      new Request(handoff, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ cookie: value }),
      }),
    );
  assert.equal((await makeHandoff("https://foreign.invalid", cookie)).status, 403);
  assert.equal((await makeHandoff(upstreamUrl, "better-auth.session_token=forged")).status, 401);
  const offered = await makeHandoff(upstreamUrl, cookie);
  assert.equal(offered.status, 200);
  const { ticket } = await offered.json();
  const redeem = () => upstream.handler(new Request(`${handoff}?ticket=${ticket}`));
  const redeemed = await redeem();
  assert.equal(redeemed.status, 303);
  assert.equal((await redeem()).status, 401);
  const upstreamCookie = redeemed.headers.get("set-cookie")?.split(";")[0];
  assert.ok(upstreamCookie);
  const readSession = () =>
    upstream.handler(
      new Request(`${upstreamUrl}/api/auth/get-session`, {
        headers: { cookie: upstreamCookie },
      }),
    );
  const verified = await readSession();
  assert.equal(verified.status, 200);
  const { user } = await verified.json();
  assert.equal(user.id, (await auth.openBotIdentity(cookie)).user.id);
  assert.equal(user.role, "user");
  await auth.logout(`Bearer ${session.token}`);
  assert.equal(await (await readSession()).json(), null);
  console.log(
    JSON.stringify({
      upstream: "2e096d685ff0f18b5e80fd72e4ad71edb1d0be43",
      identity: "passed",
      handoff: "passed",
      ticketReplay: "rejected",
      forgedCredential: "rejected",
      foreignOrigin: "rejected",
      revokedSession: "rejected",
      conversation: "not-tested",
    }),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await db.close();
}
