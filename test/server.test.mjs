import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../build/server.js";

const expectedTools = [
  "get_aha_epic",
  "get_aha_epic_features",
  "get_aha_feature",
  "get_aha_feature_comments",
  "get_aha_feature_requirements",
  "search_aha_records",
];

test("STDIO server starts, exposes read-only tools, and reports missing credentials", async () => {
  const client = new Client({ name: "test", version: "1" });
  const env = { ...process.env };
  delete env.AHA_TOKEN;
  delete env.AHA_BASE_URL;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    cwd: process.cwd(),
    env,
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), expectedTools);
    assert.ok(tools.every(tool => tool.annotations?.readOnlyHint));
    const response = await client.callTool({ name: "get_aha_feature", arguments: { feature: "ABC-123" } });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /AHA_BASE_URL/);
  } finally {
    await client.close();
  }
});

test("tools use documented endpoints, fields, pagination and bounded content", async () => {
  const calls = [];
  const api = {
    async get(path, query) {
      calls.push({ path, query });
      if (path === "/api/v3/requirements") return {
        records: [{ name: "Requirement", description: { body: "x".repeat(3001) } }],
        pagination: { has_more: true, next_cursor: "next" },
      };
      if (path === "/api/v3/epics/ABC-E-1") return { epic: { reference_num: "ABC-E-1" } };
      if (path === "/api/v3/epics/ABC-E-1/features") {
        return { features: [{ reference_num: "ABC-2" }], pagination: { has_more: false } };
      }
      if (path === "/api/v3/features/ABC-123") {
        return { record: { reference_num: "ABC-123", comments: { records: [{ body: "hello" }], has_more: true } } };
      }
      return { records: [{ name: "Login" }], pagination: { has_more: false } };
    },
  };
  const server = createServer(() => api);
  const client = new Client({ name: "test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const invoke = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    const search = await invoke("search_aha_records", { type: "features", query: "login", after: "cursor" });
    assert.equal(search.records[0].name, "Login");
    assert.equal(calls[0].path, "/api/v3/features");
    assert.equal(calls[0].query["filter.contains[name]"], "login");
    assert.equal(calls[0].query.after, "cursor");
    const requirements = await invoke("get_aha_feature_requirements", { feature: "ABC-123" });
    assert.equal(calls[1].query.feature_id, "ABC-123");
    assert.match(requirements.records[0].description.body, /\[truncated\]$/);
    assert.equal(requirements.pagination.next_cursor, "next");
    const feature = await invoke("get_aha_feature", { feature: "ABC-123" });
    assert.equal(feature.reference_num, "ABC-123");
    assert.equal(calls[2].query.fields, "default,description,custom_fields,status");
    const comments = await invoke("get_aha_feature_comments", { feature: "ABC-123" });
    assert.match(comments.note, /first 25/);
    assert.equal(calls[3].query.fields, "default,comments[default,created_at,user]");
    const epic = await invoke("get_aha_epic", { epic: "ABC-E-1" });
    assert.equal(epic.reference_num, "ABC-E-1");
    const epicFeatures = await invoke("get_aha_epic_features", { epic: "ABC-E-1" });
    assert.equal(epicFeatures.records[0].reference_num, "ABC-2");
    const bad = await client.callTool({ name: "get_aha_feature", arguments: { feature: "../secret" } });
    assert.equal(bad.isError, true);
    api.get = async () => ({ record: { custom_fields: Array(20).fill("x".repeat(3000)) } });
    const oversized = await client.callTool({ name: "get_aha_feature", arguments: { feature: "ABC-123" } });
    assert.equal(oversized.isError, true);
    assert.match(oversized.content[0].text, /too large/);
  } finally {
    await client.close();
    await server.close();
  }
});
