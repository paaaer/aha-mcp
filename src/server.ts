import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AhaClient, AhaError } from "./aha.js";
import {
  AHA_RECORD_TYPES,
  type AhaRecordType,
  RECORD_LABELS,
  parseAhaInput,
  resolveReferenceForType,
} from "./identifiers.js";

const idOrUrlInput = (example: string, label: string) =>
  z.string().trim().min(1).max(500)
    .describe(`Aha ${label} reference (e.g. ${example}), aha.io URL, or numeric ID`);

const featureInput = idOrUrlInput("ABC-123", "feature");
const epicInput = idOrUrlInput("ABC-E-123", "epic");
const releaseInput = idOrUrlInput("ABC-R-123", "release");
const workspaceInput = idOrUrlInput("ABC", "workspace");

const cursor = z.string().min(1).max(2048).optional()
  .describe("next_cursor from a previous response, with the same search parameters");
const perPage = z.number().int().min(1).max(15).default(10);
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

const RECORD_ENDPOINTS: Record<AhaRecordType, { collection: string; fields: string }> = {
  workspace: {
    collection: "projects",
    fields: "default,description,custom_fields,type,line,parent,children[default]",
  },
  feature: {
    collection: "features",
    fields: "default,description,custom_fields,status,start_date,end_date,progress,assigned_to_user,epic,project,release,initiative",
  },
  requirement: {
    collection: "requirements",
    fields: "default,description,custom_fields,status,assigned_to_user,feature",
  },
  epic: {
    collection: "epics",
    fields: "default,description,custom_fields,status,start_date,end_date,progress,assigned_to_user,project,release,initiative",
  },
  release: {
    collection: "releases",
    fields: "default,description,custom_fields,status,start_date,end_date,release_date,released_on,parking_lot,progress,owner,project,parent,release_phases[default,start_date,end_date]",
  },
  release_phase: {
    collection: "release_phases",
    fields: "default,description,custom_fields,start_date,end_date,type,progress,release",
  },
  idea: {
    collection: "ideas",
    fields: "default,description,custom_fields,status,score,endorsements_count,visibility,assigned_to_user,project",
  },
  initiative: {
    collection: "initiatives",
    fields: "default,description,custom_fields,status,start_date,end_date,progress,score,assigned_to_user,time_frame,project,parent",
  },
  goal: {
    collection: "goals",
    fields: "default,description,custom_fields,status,progress,success_metric_name,success_metric_description,time_frame,project",
  },
  document: {
    collection: "documents",
    fields: "default,description,status,type,document_date,external_url,project,parent",
  },
  task: {
    collection: "tasks",
    fields: "default,description,custom_fields,status,type,due_date,completed_date,assigned_to,record,project",
  },
};

const SEARCH_TYPES = [
  "features",
  "epics",
  "requirements",
  "ideas",
  "releases",
  "workspaces",
  "initiatives",
  "goals",
  "documents",
  "tasks",
] as const;

type SearchType = (typeof SEARCH_TYPES)[number];

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

async function fetchSingleRecord(api: AhaClient, recordType: AhaRecordType, id: string): Promise<unknown> {
  const { collection, fields } = RECORD_ENDPOINTS[recordType];
  const body = await api.get(`/api/v3/${collection}/${encodeURIComponent(id)}`, { fields });
  const raw = body.record ?? (recordType === "epic" ? body.epic : undefined);
  return compact(expectedObject(raw, RECORD_LABELS[recordType]));
}

function applyWorkspaceFilter(params: Record<string, string>, type: SearchType, workspaceId: string): void {
  const isNumeric = /^\d+$/.test(workspaceId);
  switch (type) {
    case "features":
    case "epics":
    case "releases":
    case "initiatives":
    case "goals":
      params.project_id = workspaceId;
      return;
    case "ideas":
    case "documents":
    case "tasks":
      params[isNumeric ? "filter.eq[project.id]" : "filter.eq[project.reference_prefix]"] = workspaceId;
      return;
    case "requirements":
      if (isNumeric) {
        throw new AhaError("Filtering requirements by workspace requires a workspace reference prefix (e.g. ABC).");
      }
      params["filter.starts_with[reference_num]"] = `${workspaceId}-`;
      return;
    case "workspaces":
      params["filter.contains[reference_prefix]"] = workspaceId;
      return;
  }
}

export function createServer(client: () => AhaClient = () =>
  new AhaClient(process.env.AHA_BASE_URL, process.env.AHA_TOKEN)): McpServer {
  const server = new McpServer({ name: "local-aha", version: "1.2.0" });

  server.registerTool("get_aha_record", {
    description:
      "Look up any Aha! record by reference number, workspace prefix, or aha.io URL. Automatically detects the record type from Aha's ID format: workspace (ABC), feature (ABC-123), requirement (ABC-123-1), epic (ABC-E-123), release (ABC-R-123), release phase (ABC-RP-123), idea (ABC-I-123), initiative (ABC-S-123), goal (ABC-G-123), document/note (ABC-N-123), or task (ABC-TODO-123). Prefer this tool whenever the user pastes an Aha ID or link.",
    inputSchema: {
      id_or_url: z.string().trim().min(1).max(500).describe(
        "Aha reference (e.g. ABC-123, ABC-E-123, ABC-R-12, ABC-123-1, ABC-I-5, ABC), aha.io URL, or numeric ID",
      ),
      type: z.enum(AHA_RECORD_TYPES).optional().describe(
        "Optional record type override; only needed when id_or_url is a bare numeric ID without a URL",
      ),
    },
    annotations,
  }, ({ id_or_url, type }) => respond(async () => {
    const parsed = parseAhaInput(id_or_url);
    const resolvedType = type ?? parsed.type;
    if (!resolvedType) {
      throw new AhaError(
        "Could not determine the Aha record type from this identifier. Pass a reference number (e.g. ABC-123, ABC-E-123, ABC-R-12), a full aha.io URL, or specify type.",
      );
    }
    const record = await fetchSingleRecord(client(), resolvedType, parsed.id);
    return { record_type: resolvedType, record };
  }));

  server.registerTool("search_aha_records", {
    description:
      "Search Aha! records by case-insensitive name substring (features, epics, requirements, ideas, releases, workspaces, initiatives, goals, documents, or tasks), optionally scoped to a workspace. Not a full-text search; use next_cursor for more results.",
    inputSchema: {
      type: z.enum(SEARCH_TYPES).describe("Record type to search"),
      query: z.string().trim().min(1).max(200).describe("Case-insensitive name substring"),
      workspace: workspaceInput.optional().describe("Optional workspace prefix (e.g. ABC), ID, or URL to scope the search"),
      per_page: perPage,
      after: cursor,
    },
    annotations,
  }, ({ type, query, workspace, per_page, after }) => respond(async () => {
    const collection = type === "workspaces" ? "projects" : type;
    const fields = type === "workspaces"
      ? "default,type,line,parent"
      : type === "releases"
        ? "default,status,release_date,parking_lot,project"
        : "default,status";
    const params: Record<string, string> = {
      "filter.contains[name]": query,
      per_page: String(per_page),
      fields,
    };
    if (workspace) {
      const workspaceId = resolveReferenceForType(workspace, "workspace");
      applyWorkspaceFilter(params, type, workspaceId);
    }
    if (after) params.after = after;
    return listResponse(await client().get(`/api/v3/${collection}`, params));
  }));

  server.registerTool("list_aha_workspaces", {
    description:
      "List or search Aha! workspaces (products, workspace lines, teams). Omit query and prefix to list all accessible workspaces, or filter by name or reference prefix.",
    inputSchema: {
      query: z.string().trim().min(1).max(200).optional().describe("Optional case-insensitive workspace name substring"),
      prefix: z.string().trim().min(1).max(50).optional().describe("Optional case-insensitive reference prefix substring, e.g. ABC"),
      per_page: perPage,
      after: cursor,
    },
    annotations,
  }, ({ query, prefix, per_page, after }) => respond(async () => {
    const params: Record<string, string> = {
      per_page: String(per_page),
      fields: "default,description,type,line,parent",
    };
    if (query) params["filter.contains[name]"] = query;
    if (prefix) {
      if (!/^[A-Za-z0-9_]+$/.test(prefix)) {
        throw new AhaError("Workspace prefix filter may only contain letters, digits, and underscores.");
      }
      params["filter.contains[reference_prefix]"] = prefix;
    }
    if (after) params.after = after;
    return listResponse(await client().get("/api/v3/projects", params));
  }));

  server.registerTool("get_aha_workspace", {
    description: "Get an Aha! workspace's details, description, parent/child hierarchy, and custom fields by prefix (e.g. ABC), ID, or URL.",
    inputSchema: { workspace: workspaceInput },
    annotations,
  }, ({ workspace }) => respond(async () => {
    const id = resolveReferenceForType(workspace, "workspace");
    return fetchSingleRecord(client(), "workspace", id);
  }));

  server.registerTool("list_aha_releases", {
    description:
      "List or search Aha! releases, optionally scoped to a workspace and/or filtered by release name substring or parking-lot status.",
    inputSchema: {
      workspace: workspaceInput.optional().describe("Optional workspace prefix (e.g. ABC), ID, or URL"),
      query: z.string().trim().min(1).max(200).optional().describe("Optional case-insensitive release name substring"),
      parking_lot: z.boolean().optional().describe("Optional filter: true for parking lots only, false for scheduled releases only"),
      per_page: perPage,
      after: cursor,
    },
    annotations,
  }, ({ workspace, query, parking_lot, per_page, after }) => respond(async () => {
    const params: Record<string, string> = {
      per_page: String(per_page),
      fields: "default,status,start_date,end_date,release_date,released_on,parking_lot,progress,owner,project",
    };
    if (workspace) params.project_id = resolveReferenceForType(workspace, "workspace");
    if (query) params["filter.contains[name]"] = query;
    if (parking_lot !== undefined) params["filter.eq[parking_lot]"] = String(parking_lot);
    if (after) params.after = after;
    return listResponse(await client().get("/api/v3/releases", params));
  }));

  server.registerTool("get_aha_release", {
    description: "Get an Aha! release's details, dates, status, phases, description, and custom fields by reference (e.g. ABC-R-123), ID, or URL.",
    inputSchema: { release: releaseInput },
    annotations,
  }, ({ release }) => respond(async () => {
    const id = resolveReferenceForType(release, "release");
    return fetchSingleRecord(client(), "release", id);
  }));

  server.registerTool("get_aha_release_features", {
    description: "List the features (or epics) planned in an Aha! release. Use next_cursor to retrieve additional pages.",
    inputSchema: {
      release: releaseInput,
      record_type: z.enum(["features", "epics"]).default("features").describe("List features or epics in this release"),
      per_page: perPage,
      after: cursor,
    },
    annotations,
  }, ({ release, record_type, per_page, after }) => respond(async () => {
    const id = resolveReferenceForType(release, "release");
    const params: Record<string, string> = {
      release_id: id,
      fields: record_type === "features" ? "default,status,assigned_to_user,epic" : "default,status,assigned_to_user",
      per_page: String(per_page),
    };
    if (after) params.after = after;
    return listResponse(await client().get(`/api/v3/${record_type}`, params));
  }));

  server.registerTool("get_aha_feature", {
    description: "Get a feature's details, description and custom fields. Acceptance criteria may appear in its description, custom fields, or requirements.",
    inputSchema: { feature: featureInput },
    annotations,
  }, ({ feature }) => respond(async () => {
    const id = resolveReferenceForType(feature, "feature");
    return fetchSingleRecord(client(), "feature", id);
  }));

  server.registerTool("get_aha_epic", {
    description: "Get an epic's details, description and custom fields. Epic references contain -E-, for example ABC-E-123 (URLs under /epics/).",
    inputSchema: { epic: epicInput },
    annotations,
  }, ({ epic }) => respond(async () => {
    const id = resolveReferenceForType(epic, "epic");
    return fetchSingleRecord(client(), "epic", id);
  }));

  server.registerTool("get_aha_epic_features", {
    description: "List the features that belong to an epic. Use next_cursor to retrieve additional pages.",
    inputSchema: { epic: epicInput, per_page: perPage, after: cursor },
    annotations,
  }, ({ epic, per_page, after }) => respond(async () => {
    const id = resolveReferenceForType(epic, "epic");
    const filterKey = /^\d+$/.test(id) ? "filter.eq[epic.id]" : "filter.eq[epic.reference_num]";
    const params: Record<string, string> = {
      [filterKey]: id,
      fields: "default,status,assigned_to_user,release",
      per_page: String(per_page),
    };
    if (after) params.after = after;
    return listResponse(await client().get("/api/v3/features", params));
  }));

  server.registerTool("get_aha_feature_requirements", {
    description: "List a feature's requirements, descriptions and custom fields. Use next_cursor to retrieve additional pages.",
    inputSchema: { feature: featureInput, per_page: perPage, after: cursor },
    annotations,
  }, ({ feature, per_page, after }) => respond(async () => {
    const id = resolveReferenceForType(feature, "feature");
    const params: Record<string, string> = {
      feature_id: id,
      fields: "default,description,custom_fields,status,assigned_to_user",
      per_page: String(per_page),
    };
    if (after) params.after = after;
    return listResponse(await client().get("/api/v3/requirements", params));
  }));

  server.registerTool("get_aha_feature_comments", {
    description: "Get up to the first 25 comments on a feature. Check has_more; additional comments must be viewed in Aha.",
    inputSchema: { feature: featureInput },
    annotations,
  }, ({ feature }) => respond(async () => {
    const id = resolveReferenceForType(feature, "feature");
    const body = await client().get(`/api/v3/features/${encodeURIComponent(id)}`, {
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
