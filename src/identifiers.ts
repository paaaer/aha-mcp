import { AhaError } from "./aha.js";

export const AHA_RECORD_TYPES = [
  "workspace",
  "feature",
  "requirement",
  "epic",
  "release",
  "release_phase",
  "idea",
  "initiative",
  "goal",
  "document",
  "task",
] as const;

export type AhaRecordType = (typeof AHA_RECORD_TYPES)[number];

export interface ParsedAhaReference {
  id: string;
  type?: AhaRecordType;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const NUMERIC_ID = /^\d+$/;
const PREFIX = "[A-Z0-9_]*[A-Z][A-Z0-9_]*";

const REFERENCE_PATTERNS: ReadonlyArray< readonly [RegExp, AhaRecordType] > = [
  [new RegExp(`^${PREFIX}-E-\\d+$`), "epic"],
  [new RegExp(`^${PREFIX}-(?:R|L)-\\d+$`), "release"],
  [new RegExp(`^${PREFIX}-RP-\\d+$`), "release_phase"],
  [new RegExp(`^${PREFIX}-I-\\d+$`), "idea"],
  [new RegExp(`^${PREFIX}-S-\\d+$`), "initiative"],
  [new RegExp(`^${PREFIX}-G-\\d+$`), "goal"],
  [new RegExp(`^${PREFIX}-N-\\d+$`), "document"],
  [new RegExp(`^${PREFIX}-(?:TODO|T)-\\d+$`), "task"],
  [new RegExp(`^${PREFIX}-\\d+-\\d+$`), "requirement"],
  [new RegExp(`^${PREFIX}-\\d+$`), "feature"],
  [new RegExp(`^${PREFIX}$`), "workspace"],
];

const URL_SECTION_TYPES: Record<string, AhaRecordType> = {
  epics: "epic",
  features: "feature",
  activities: "feature",
  requirements: "requirement",
  releases: "release",
  release_phases: "release_phase",
  ideas: "idea",
  initiatives: "initiative",
  goals: "goal",
  strategic_imperatives: "goal",
  pages: "document",
  documents: "document",
  tasks: "task",
};

export const RECORD_LABELS: Record<AhaRecordType, string> = {
  workspace: "workspace",
  feature: "feature",
  requirement: "requirement",
  epic: "epic",
  release: "release",
  release_phase: "release phase",
  idea: "idea",
  initiative: "initiative",
  goal: "goal",
  document: "document/note",
  task: "task",
};

export const DEDICATED_GET_TOOLS: Partial<Record<AhaRecordType, string>> = {
  workspace: "get_aha_workspace",
  feature: "get_aha_feature",
  epic: "get_aha_epic",
  release: "get_aha_release",
};

export function classifyAhaReference(id: string): AhaRecordType | undefined {
  if (NUMERIC_ID.test(id)) return undefined;
  const upper = id.toUpperCase();
  for (const [pattern, type] of REFERENCE_PATTERNS) {
    if (pattern.test(upper)) return type;
  }
  return undefined;
}

function normalizeToken(rawToken: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawToken).trim();
  } catch {
    throw new AhaError("Invalid Aha reference or URL.");
  }
  if (!SAFE_ID.test(decoded)) {
    throw new AhaError("Invalid Aha reference or URL.");
  }
  return NUMERIC_ID.test(decoded) ? decoded : decoded.toUpperCase();
}

function extractFromSegments(segments: string[]): ParsedAhaReference | undefined {
  for (let i = segments.length - 2; i >= 0; i--) {
    const section = segments[i].toLowerCase();
    const candidate = segments[i + 1];
    if (section === "ideas" && candidate.toLowerCase() === "ideas") continue;
    const urlType = URL_SECTION_TYPES[section];
    if (urlType) {
      let id: string;
      try {
        id = normalizeToken(candidate);
      } catch {
        continue;
      }
      const refType = classifyAhaReference(id);
      if (refType && refType !== "workspace") {
        return { id, type: refType };
      }
      if (NUMERIC_ID.test(id)) {
        return { id, type: urlType };
      }
    }
  }
  for (let i = 0; i < segments.length - 1; i++) {
    const section = segments[i].toLowerCase();
    if (section === "projects" || section === "products") {
      const id = normalizeToken(segments[i + 1]);
      return { id, type: classifyAhaReference(id) ?? "workspace" };
    }
  }
  return undefined;
}

export function parseAhaInput(raw: string): ParsedAhaReference {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) {
    throw new AhaError("Invalid Aha reference or URL.");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new AhaError("Invalid Aha URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new AhaError("Aha URLs must use HTTPS without credentials.");
    }

    const drawer = url.searchParams.get("drawer");
    if (drawer) {
      const fromDrawer = extractFromSegments(drawer.split("/").filter(Boolean));
      if (fromDrawer) return fromDrawer;
    }

    const fromPath = extractFromSegments(url.pathname.split("/").filter(Boolean));
    if (fromPath) return fromPath;

    throw new AhaError("Could not extract an Aha record reference from the URL.");
  }

  const id = normalizeToken(trimmed);
  return { id, type: classifyAhaReference(id) };
}

export function resolveReferenceForType(raw: string, expectedType: AhaRecordType): string {
  const parsed = parseAhaInput(raw);
  if (parsed.type && parsed.type !== expectedType) {
    const toolHint = DEDICATED_GET_TOOLS[parsed.type];
    const article = /^[aeiou]/i.test(RECORD_LABELS[parsed.type]) ? "an" : "a";
    throw new AhaError(
      `${parsed.id} is ${article} ${RECORD_LABELS[parsed.type]} reference, not a ${RECORD_LABELS[expectedType]}. Use get_aha_record${toolHint ? ` or ${toolHint}` : ""} instead.`,
    );
  }
  return parsed.id;
}
