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
  "get_aha_record",
  "get_aha_release",
  "get_aha_release_features",
  "get_aha_workspace",
  "list_aha_releases",
  "list_aha_workspaces",
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
      if (path === "/api/v3/requirements" && query.feature_id) return {
        records: [{ name: "Requirement", description: { body: "x".repeat(3001) } }],
        pagination: { has_more: true, next_cursor: "next" },
      };
      if (path === "/api/v3/epics/ABC-E-1") return { record: { reference_num: "ABC-E-1" } };
      if (path === "/api/v3/features" && query["filter.eq[epic.reference_num]"] === "ABC-E-1") {
        return { records: [{ reference_num: "ABC-2" }], pagination: { has_more: false } };
      }
      if (path === "/api/v3/features/ABC-123") {
        return { record: { reference_num: "ABC-123", comments: { records: [{ body: "hello" }], has_more: true } } };
      }
      if (path === "/api/v3/projects") {
        return { records: [{ reference_prefix: "ABC", name: "Platform" }], pagination: { has_more: false } };
      }
      if (path === "/api/v3/projects/ABC") {
        return { record: { reference_prefix: "ABC", name: "Platform" } };
      }
      if (path === "/api/v3/releases") {
        return { records: [{ reference_num: "ABC-R-12", name: "2026.1" }], pagination: { has_more: false } };
      }
      if (path === "/api/v3/releases/ABC-R-12") {
        return { record: { reference_num: "ABC-R-12", name: "2026.1" } };
      }
      if (path === "/api/v3/epics" && query.release_id === "ABC-R-12") {
        return { records: [{ reference_num: "ABC-E-9" }], pagination: { has_more: false } };
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

    const search = await invoke("search_aha_records", { type: "features", query: "login", workspace: "ABC", after: "cursor" });
    assert.equal(search.records[0].name, "Login");
    assert.equal(calls[0].path, "/api/v3/features");
    assert.equal(calls[0].query["filter.contains[name]"], "login");
    assert.equal(calls[0].query.project_id, "ABC");
    assert.equal(calls[0].query.after, "cursor");

    const requirements = await invoke("get_aha_feature_requirements", { feature: "ABC-123" });
    assert.equal(calls[1].query.feature_id, "ABC-123");
    assert.match(requirements.records[0].description.body, /\[truncated\]$/);
    assert.equal(requirements.pagination.next_cursor, "next");

    const feature = await invoke("get_aha_feature", { feature: "https://example.aha.io/features/ABC-123" });
    assert.equal(feature.reference_num, "ABC-123");
    assert.match(calls[2].query.fields, /description,custom_fields,status/);

    const comments = await invoke("get_aha_feature_comments", { feature: "ABC-123" });
    assert.match(comments.note, /first 25/);
    assert.equal(calls[3].query.fields, "default,comments[default,created_at,user]");

    const epic = await invoke("get_aha_epic", { epic: "https://example.aha.io/epics/ABC-E-1" });
    assert.equal(epic.reference_num, "ABC-E-1");

    const epicFeatures = await invoke("get_aha_epic_features", { epic: "ABC-E-1" });
    assert.equal(epicFeatures.records[0].reference_num, "ABC-2");
    assert.equal(calls[5].path, "/api/v3/features");
    assert.equal(calls[5].query["filter.eq[epic.reference_num]"], "ABC-E-1");

    const workspaces = await invoke("list_aha_workspaces", { query: "Plat", prefix: "AB" });
    assert.equal(workspaces.records[0].reference_prefix, "ABC");
    assert.equal(calls[6].path, "/api/v3/projects");
    assert.equal(calls[6].query["filter.contains[name]"], "Plat");
    assert.equal(calls[6].query["filter.contains[reference_prefix]"], "AB");

    const workspace = await invoke("get_aha_workspace", { workspace: "https://example.aha.io/products/ABC/feature-cards" });
    assert.equal(workspace.reference_prefix, "ABC");
    assert.equal(calls[7].path, "/api/v3/projects/ABC");

    const releases = await invoke("list_aha_releases", { workspace: "ABC", query: "2026", parking_lot: false });
    assert.equal(releases.records[0].reference_num, "ABC-R-12");
    assert.equal(calls[8].path, "/api/v3/releases");
    assert.equal(calls[8].query.project_id, "ABC");
    assert.equal(calls[8].query["filter.contains[name]"], "2026");
    assert.equal(calls[8].query["filter.eq[parking_lot]"], "false");

    const release = await invoke("get_aha_release", { release: "ABC-R-12" });
    assert.equal(release.reference_num, "ABC-R-12");

    const releaseEpics = await invoke("get_aha_release_features", { release: "ABC-R-12", record_type: "epics" });
    assert.equal(releaseEpics.records[0].reference_num, "ABC-E-9");
    assert.equal(calls[10].path, "/api/v3/epics");
    assert.equal(calls[10].query.release_id, "ABC-R-12");

    const wrongTool = await client.callTool({ name: "get_aha_feature", arguments: { feature: "ABC-E-1" } });
    assert.equal(wrongTool.isError, true);
    assert.match(wrongTool.content[0].text, /epic reference.*get_aha_record or get_aha_epic/);

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

test("get_aha_record automatically routes Aha reference conventions and URLs", async () => {
  const seen = [];
  const api = {
    async get(path) {
      seen.push(path);
      return { record: { path } };
    },
  };
  const server = createServer(() => api);
  const client = new Client({ name: "test", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const invoke = async (args) => JSON.parse((await client.callTool({ name: "get_aha_record", arguments: args })).content[0].text);

    const cases = [
      [{ id_or_url: "ABC" }, "workspace", "/api/v3/projects/ABC"],
      [{ id_or_url: "abc-123" }, "feature", "/api/v3/features/ABC-123"],
      [{ id_or_url: "ABC-123-2" }, "requirement", "/api/v3/requirements/ABC-123-2"],
      [{ id_or_url: "ABC-E-42" }, "epic", "/api/v3/epics/ABC-E-42"],
      [{ id_or_url: "ABC-R-7" }, "release", "/api/v3/releases/ABC-R-7"],
      [{ id_or_url: "ABC-RP-3" }, "release_phase", "/api/v3/release_phases/ABC-RP-3"],
      [{ id_or_url: "ABC-I-99" }, "idea", "/api/v3/ideas/ABC-I-99"],
      [{ id_or_url: "ABC-S-4" }, "initiative", "/api/v3/initiatives/ABC-S-4"],
      [{ id_or_url: "ABC-G-8" }, "goal", "/api/v3/goals/ABC-G-8"],
      [{ id_or_url: "ABC-N-15" }, "document", "/api/v3/documents/ABC-N-15"],
      [{ id_or_url: "ABC-TODO-6" }, "task", "/api/v3/tasks/ABC-TODO-6"],
      [{ id_or_url: "https://example.aha.io/products/ABC/pages/ABC-N-15" }, "document", "/api/v3/documents/ABC-N-15"],
      [{ id_or_url: "https://example.aha.io/ideas/ideas/ABC-I-99" }, "idea", "/api/v3/ideas/ABC-I-99"],
      [{ id_or_url: "https://example.aha.io/products/ABC/feature-cards?drawer=epics/ABC-E-42" }, "epic", "/api/v3/epics/ABC-E-42"],
      [{ id_or_url: "https://example.aha.io/releases/987654" }, "release", "/api/v3/releases/987654"],
      [{ id_or_url: "987654", type: "feature" }, "feature", "/api/v3/features/987654"],
    ];

    for (const [args, expectedType, expectedPath] of cases) {
      const res = await invoke(args);
      assert.equal(res.record_type, expectedType);
      assert.equal(res.record.path, expectedPath);
    }

    const bareNumeric = await client.callTool({ name: "get_aha_record", arguments: { id_or_url: "987654" } });
    assert.equal(bareNumeric.isError, true);
    assert.match(bareNumeric.content[0].text, /specify type/);
  } finally {
    await client.close();
    await server.close();
  }
});
