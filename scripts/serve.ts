// Static server with SPA fallback for smoke-testing the rebuilt bundle.
const root = process.argv[2], port = +process.argv[3];
Bun.serve({ port, hostname: "0.0.0.0", async fetch(req) {
  const p = new URL(req.url).pathname;
  const f = Bun.file(root + p);
  if (p !== "/" && await f.exists()) return new Response(f);
  if (p.startsWith("/assets/")) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(root + "/index.html"), { headers: { "content-type": "text/html" } });
}});
console.log("listening", port);
