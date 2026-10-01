// The upstream entry point calls Bun.serve directly. Bind the spike to loopback only.
const serve = Bun.serve.bind(Bun);
Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) =>
  serve({ ...options, hostname: "127.0.0.1" })) as typeof Bun.serve;
await import("../../artifacts/openbot-source/server/src/index.ts");
