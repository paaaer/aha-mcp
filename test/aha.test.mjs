import test from "node:test";
import assert from "node:assert/strict";
import { AhaClient } from "../build/aha.js";

test("validates credentials and HTTPS origin", () => {
  assert.throws(() => new AhaClient(undefined, "x"), /AHA_BASE_URL/);
  assert.throws(() => new AhaClient("https://example.aha.io", undefined), /AHA_TOKEN/);
  assert.throws(() => new AhaClient("http://example.aha.io", "x"), /HTTPS/);
  assert.throws(() => new AhaClient("https://example.aha.io/path", "x"), /HTTPS/);
});

test("sends authenticated GET to the configured API without following redirects", async () => {
  let called;
  const client = new AhaClient("https://example.aha.io", "fake-token", async (url, options) => {
    called = { url: url.toString(), options };
    return Response.json({ record: { id: "1" } });
  });
  assert.deepEqual(await client.get("/api/v3/features/ABC-123"), { record: { id: "1" } });
  assert.equal(called.url, "https://example.aha.io/api/v3/features/ABC-123");
  assert.equal(called.options.method, "GET");
  assert.equal(called.options.redirect, "error");
  assert.equal(called.options.headers.Authorization, "Bearer fake-token");
  await assert.rejects(client.get("/api/v3/../../other"), /Invalid Aha API path/);
});

test("errors are actionable and do not include response bodies or tokens", async () => {
  for (const [status, message] of [
    [401, /authentication failed/],
    [403, /access denied/],
    [404, /not found/],
    [429, /rate limit/],
    [500, /HTTP 500/],
  ]) {
    const client = new AhaClient("https://example.aha.io", "fake-token", async () =>
      new Response("fake-token", { status }));
    await assert.rejects(client.get("/api/v3/features"), error =>
      message.test(error.message) && !error.message.includes("fake-token"));
  }
  const client = new AhaClient("https://example.aha.io", "fake-token", async () => {
    throw new Error("fake-token");
  });
  await assert.rejects(client.get("/api/v3/features"), error =>
    /network/i.test(error.message) && !error.message.includes("fake-token"));
});
