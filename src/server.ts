import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AhaClient, AhaError } from "./aha.js";

const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)
  .describe("Aha feature reference number or ID, for example ABC-123");
const epicReference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)
  .describe("Aha epic reference number or ID, for example ABC-E-123");
const cursor = z.string().min(1).max(2048).optional()
  .describe("next_cursor from a previous response, with the same search parameters");
const perPage = z.number().int().min(1).max(15).default(10);
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

function compact(value: unknown): unknown {
  if (typeof value === "string" && value.length > 3000) {
    return value.slice(0, 3000) + "\n[truncated]";
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 25).map(compact);
    if (value.length > 25) items.push(`[${value.length - 25} more items omitted]`);
    return items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
  }
  return value;
}

function expectedObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AhaError(`Aha returned an unexpected ${name} response.`);
  }
  return value as Record<string, unknown>;
}

function listResponse(body: Record<string, unknown>): object {
  if (!Array.isArray(body.records)) throw new AhaError("Aha returned an unexpected list response.");
  return { records: compact(body.records), pagination: compact(body.pagination ?? null) };
}

function result(data: unknown) {
  const text = JSON.stringify(data, null, 2);
  if (text.length > 40_000) {
    throw new AhaError("Aha response is too large for context. Try a smaller per_page or view the record in Aha.");
  }
  return { content: [{ type: "text" as const, text }] };
}

async function respond(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof AhaError ? error.message : "Unexpected error while reading Aha." }],
    };
  }
}

export function createServer(client: () => AhaClient = () =>
  new AhaClient(process.env.AHA_BASE_URL, process.env.AHA_TOKEN)): McpServer {
  const server = new McpServer({ name: "local-aha", version: "1.0.0" });

  server.registerTool("search_aha_records", {
    description: "Search the names of Aha features, requirements, or ideas. This is not a full-text or cross-type search; use next_cursor for more results.",
    inputSchema: {
      type: z.enum(["features", "requirements", "ideas"]).describe("Record type to search"),
      query: z.string().trim().min(1).max(200).describe("Case-insensitive name substring"),
      per_page: perPage,
      after: cursor,
    },
    annotations,
  }, ({ type, query, per_page, after }) => respond(async () => {
    const params: Record<string, string> = {
      "filter.contains[name]": query,
      per_page: String(per_page),
      fields: "default",
    };
    if (after) params.after = after;
    return listResponse(await client().get(`/api/v3/${type}`, params));
  }));

  server.registerTool("get_aha_feature", {
    description: "Get a feature's details, description and custom fields. Acceptance criteria may appear in its description, custom fields, or requirements.",
    inputSchema: { feature: reference },
    annotations,
  }, ({ feature }) => respond(async () => {
    const body = await client().get(`/api/v3/features/${encodeURIComponent(feature)}`, {
      fields: "default,description,custom_fields,status",
    });
    return compact(expectedObject(body.record, "feature"));
  }));

  server.registerTool("get_aha_epic", {
    description: "Get an epic's details, description and custom fields. Epic references contain -E-, for example ABC-E-123 (URLs under /epics/).",
    inputSchema: { epic: epicReference },
    annotations,
  }, ({ epic }) => respond(async () => {
    const body = await client().get(`/api/v3/epics/${encodeURIComponent(epic)}`, {
      fields: "default,description,custom_fields,status",
    });
    return compact(expectedObject(body.epic ?? body.record, "epic"));
  }));

  server.registerTool("get_aha_epic_features", {
    description: "List the features that belong to an epic. Use next_cursor to retrieve additional pages.",
    inputSchema: { epic: epicReference, per_page: perPage, after: cursor },
    annotations,
  }, ({ epic, per_page, after }) => respond(async () => {
    const params: Record<string, string> = { per_page: String(per_page) };
    if (after) params.after = after;
    const body = await client().get(`/api/v3/epics/${encodeURIComponent(epic)}/features`, params);
    return listResponse({ records: body.records ?? body.features, pagination: body.pagination });
  }));

  server.registerTool("get_aha_feature_requirements", {
    description: "List a feature's requirements, descriptions and custom fields. Use next_cursor to retrieve additional pages.",
    inputSchema: { feature: reference, per_page: perPage, after: cursor },
    annotations,
  }, ({ feature, per_page, after }) => respond(async () => {
    const params: Record<string, string> = {
      feature_id: feature,
      fields: "default,description,custom_fields",
      per_page: String(per_page),
    };
    if (after) params.after = after;
    return listResponse(await client().get("/api/v3/requirements", params));
  }));

  server.registerTool("get_aha_feature_comments", {
    description: "Get up to the first 25 comments on a feature. Check has_more; additional comments must be viewed in Aha.",
    inputSchema: { feature: reference },
    annotations,
  }, ({ feature }) => respond(async () => {
    const body = await client().get(`/api/v3/features/${encodeURIComponent(feature)}`, {
      fields: "default,comments[default,created_at,user]",
    });
    const record = expectedObject(body.record, "feature");
    const comments = expectedObject(record.comments, "feature comments");
    return compact({
      feature: record.reference_num,
      comments,
      note: comments.has_more ? "Only the first 25 comments are available here; view the rest in Aha." : undefined,
    });
  }));

  return server;
}
