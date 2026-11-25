# Aha! REST API research (read-only MCP server)

Researched 2026-11-25 from official Aha! docs only. No credentials or customer data used; only public docs fetched.

Sources (all official):
- [S1] https://www.aha.io/api (v1 intro: auth, pagination, errors, rate limit, `fields`)
- [S2] https://www.aha.io/openapi.json (v1 OpenAPI 3.1; parameters only, **no response schemas**)
- [S3] https://www.aha.io/api/v3 (v3 intro) and [S4] https://www.aha.io/api/v3/openapi.json (v3 OpenAPI; has response schemas)
- [S5] https://www.aha.io/api/resources/features/list_features
- [S6] https://www.aha.io/api/resources/features/get_a_specific_feature
- [S7] https://www.aha.io/api/resources/comments/list_comments_on_a_feature

## 1. Version choice
[S1]/[S3]: Aha! recommends v3 wherever it covers the need; v1 for the rest; both work with the same API key. v3 has the richer filtering, documented response schemas, cursor pagination. v1 has per-parent endpoints (e.g. comments on a feature) and `q` name search.

## 2. Base URL and authentication
- HTTPS only; must use account domain `https://<company>.aha.io` [S1 "URLs"]. v1 base `/api/v1`; v3 base `/api/v3` [S2 servers, S4 servers].
- `Authorization: Bearer <API key or OAuth2 token>` [S1 "API key"; S3 "Authentication"]. API key generated at https://secure.aha.io/settings/api_keys; it carries the permissions of the generating user. v3 says: Settings > Personal > Developer > API key.
- OAuth2 is preferred for user-interactive apps; API key best for services [S1]. Basic auth is legacy/not recommended [S1].
- v1 doc recommends a custom `User-Agent` with a contact [S1 "User agent"].
- Auth errors: v1 doc says `403` for incorrect auth info; `404` may also mean no access to record [S1 "Errors"].

## 3. Pagination, limits
**v1** [S1]: wrapper `{"pagination": [{"total_records","total_pages","current_page"}], "<collection>": [...]}` (note `pagination` is shown as an array in the doc sample). `page` (1-indexed), `per_page` default 30, max 200.
**v3** [S3, S4 PaginationMeta]: `{"records":[...], "pagination": {"has_more", "next_cursor", "next_url", "truncated"?, "truncated_message"?}}`. `per_page` default 25, max 200; cursor via `after` (opaque, reuse same filters/sort). Default order: ID descending, unlimited traversal. Any `sort.asc`/`sort.desc` (even by id) caps results at the first 1,000 records (`pagination.truncated: true`; paging past gives `pagination.max_records_exceeded`).
**Rate limit** [S1]: 300 requests/min and 20/sec, per account (shared across users). Exceeding -> `429`, headers `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` (UTC unix time). `504` = request timed out from too much data; page or limit fields. `400` bad request, `500` server error.
`fields` param (both versions): v1 `fields=name,reference_num,...`, `fields=*` allowed but not recommended in production [S1]. v3 `fields=default,assigned_to_user`, nested `status[id,name]`, `requirements[id,name]`, `custom_fields.key`; collections only selectable on top-level resource (`fields.nested_collection` error); unknown -> `fields.unknown` [S3].
Whether v3 has its own documented rate limit: not found in S3/S4 (assume the v1 account limit; unverified).

## 4. Search features / broader records
**No global cross-record full-text search endpoint was found** in v1 [S2] or v3 [S4] path lists (searched for "search" in paths: only custom_object records matched). Search = filtered list per record type.

### v3 list features — `GET /api/v3/features` [S4 listFeatures]
Params: `project_id` (ID or ref prefix), `release_id`, `per_page`, `after`, `fields`, `sort.asc`, `sort.desc`, `filter.{eq,not_eq,contains,starts_with,in,not_in,empty,not_empty,gt,gte,lt,lte,between}[field]`. Operators allowed per field via `x-aha-fields`; e.g. `name` and `reference_num`: eq, not_eq, contains (case-insensitive), starts_with, in, not_in, empty, not_empty; `created_at`/`updated_at`: eq, gt, gte, lt, lte, between, empty, not_empty (sortable). `id` sortable. Embedded associations filterable by subfield, e.g. `filter.eq[status.name]=In%20progress`, `filter.in[tags.name]=Backend,API`, custom: `filter.eq[custom_fields.<key>]` (text/url/number/date/checkbox only) [S3].
Example from docs: `/api/v3/features?filter.contains[name]=login&filter.eq[status.name]=In%20progress` [S3].
Default fields: `id, html_url, url, name, reference_num` [S4 Feature.description]. Other fields: created_at, updated_at, start_date, end_date, progress, score, estimates, position, epic, status, type, assigned_to_user, created_by_user, description (object `{id, body(HTML), editor_version, created_at, updated_at}`), project, release, release_phase, iteration, initiative, team, tags, requirements, goals, key_results, score_facts, watchers, comments, custom_fields, workflow_status_times (collections omitted by default; inline collections capped at 25 records with `has_more`/`next_url`) [S4 Feature, CommentCollection].
Response: `{"records":[Feature...], "pagination":{...}}`.

### v1 list features — `GET /api/v1/features` [S5]
Params: `page`, `per_page`, `q` (match against feature name), `updated_since` (ISO8601 UTC), `tag`, `assigned_to_user` (ID or email), `workflow_status` (ID or name), `custom_fields` (hash). Also `fields`. Scoped variants documented: `/api/v1/releases/:id/features`, `/api/v1/products/:id/features`, `/api/v1/epics/:id/features` [S2, S5 links]. Response collection key `features` (sample in S1: `reference_num`, `name`, `id`).

### Broader records (v3 list endpoints, all same filter/pagination conventions) [S4 paths]
`/api/v3/{features, epics, requirements, ideas, releases, release_phases, initiatives, goals, key_results, tasks, comments, projects, documents, ...}` plus `/{id}`. Ideas: `GET /api/v3/ideas` (+ `portal_comments`). v1 ideas: `GET /api/v1/ideas` with `q`, `workflow_status`, `assigned_to_user`, `tag`, `user_id`, `spam`, `created_since`, `created_before`, `updated_since`, `sort`, `fields` [S2]. v1 products: `GET /api/v1/products` [S2]. Idea schema (v3): id, html_url, url, name, reference_num, score, endorsements_count, spam, visibility, created_at, updated_at, status, project, description, assigned_to_user, ... [S4 Idea].

## 5. Fetch a feature by reference or id
- v1: `GET /api/v1/features/:id` — "Numeric ID or key of the feature", example `/api/v1/features/PRJ1-1?fields=*%2Ccustom_field_record_values` [S6]; also `curl .../api/v1/features/APP-1` [S1]. Response body example not statically available on the page (rendered client-side; I could not retrieve it). v1 OpenAPI has no response schema [S2].
- v3: `GET /api/v3/features/{id}` — "ID or reference number of the feature", query `fields`. Response `{"record": Feature}` [S4 getFeature]. Custom fields omitted unless requested.
- Reference pattern: `PROJ-123` feature; requirement refs like `PROJ-123-1` (inferred, not stated in fetched text).

## 6. Requirements
- v3: `GET /api/v3/requirements` params `feature_id` (ID or reference), standard `filter.*`, `sort.*`, `fields`, `per_page`, `after`; `GET /api/v3/requirements/{id}` [S4]. Response `{"records":[Requirement]}` / `{"record":Requirement}`. Requirement fields: id, html_url, url, name, reference_num, created_at, updated_at, dates, position, estimates, status, assigned_to_user, description `{body HTML}`, feature, iteration, created_by_user, team, tags, comments, custom_fields, workflow_status_times.
- v3 alternative: embed via `GET /api/v3/features/{id}?fields=default,requirements[id,name,description]` [S3 "Fields"].
- v1: `GET /api/v1/features/:feature_id/requirements` params `page`, `per_page`, `updated_since`; `GET /api/v1/requirements/:id`; `GET /api/v1/requirements/fields/:field_name/value/:field_value` [S2].

## 7. Comments / discussions
- v3: `GET /api/v3/comments` (filterable; no `record_id` query param in the spec; `record` is an embed filterable by `id` with eq/in etc. per `x-aha-fields`) and `GET /api/v3/comments/{id}`. Comment fields: id, html_url, url, body (HTML), created_at, updated_at, user, record (LinkedRecordNested), parent (top-level comment replied to), attachments (omitted by default) [S4 Comment]. Default fields: id, html_url, url, body.
- v3 inline: `GET /api/v3/features/{id}?fields=default,comments[id,body,user]` — inline comment collection capped at 25, with `has_more`/`next_url` to full collection [S4 CommentCollection].
- v1 (simple per-record paging): `GET /api/v1/features/:feature_id/comments` (`page`, `per_page`) [S7]; also `/requirements/:id/comments`, `/epics/:id/comments`, `/ideas/:id/comments`, `/initiatives/:id/comments`, `/goals/:id/comments`, `/releases/:id/comments`, `/release_phases/:id/comments`, `/tasks/:id/comments`, `/products/:id/comments`; `GET /api/v1/comments/:id` [S2, S7 list]. Replies: `parent_comment_id`, only one level [S7].
- Idea discussions: v1 `GET /api/v1/ideas/:idea_id/idea_comments` (portal/idea comments) [S2]; v3 `GET /api/v3/portal_comments` [S4].

## 8. Read-only considerations
All needed operations are `GET`. API key inherits user permissions (use a dedicated read-only-ish user; Aha! docs do not describe scoped read-only keys — not found). Descriptions/comments are HTML.

## 9. Uncertainties / not verified
1. Exact JSON response examples for v1 endpoints (get feature, comments, requirements): doc pages render bodies client-side; v1 OpenAPI has no response schemas. Only the pagination sample in [S1] is verified. v3 schemas are verified.
2. v3 comments-by-feature filter syntax (e.g. `filter.eq[record.id]=...`) is inferred from `x-aha-fields` (`record` embed with `id_filter_operators`); actual semantic untested. Safe fallback: v1 `/features/:id/comments` or v3 `features/{id}?fields=...comments[...]`.
3. No global search endpoint found; v1 `q` for features/ideas name only. v3 uses `filter.contains[name]`.
4. v3 rate limits and error body shape not documented in the fetched sections.
5. v1 `pagination` shown as array in the sample (odd but documented).
6. Whether v3 `reference_num` accepts requirement references with `/api/v3/features/{id}`: only features documented.

---
## Addendum: verified v3 field syntax and schemas (2026-11-25)
Source: https://www.aha.io/api/v3/openapi.json (schemas `Feature`, `Requirement`, `Idea`, `Comment`, `NoteNested`, `CustomFields`, `RequirementCollection`, `CommentCollection`, `PaginationMeta`; operation `/api/v3/requirements`) and https://www.aha.io/api/v3 ("Fields", "Pagination"). The official docs contain **no full example response bodies**; the quotes below are schema descriptions and example request strings.

**Descriptions are objects, not strings.** `Feature.description`, `Requirement.description`, `Idea.description` -> `NoteNested`: `{id:int, body:string, editor_version:int, created_at, updated_at}`; "Default fields: id, body"; property description: "HTML description of the record." Select with `fields=default,description` (gives `description:{id,body}`) or `description.body`/`description[body]` (dot/bracket syntax per v3 "Fields"). Only `description.body` is HTML.

**Custom fields** (`CustomFields`): "Custom field values. Property names are custom field definition keys... Omitted unless requested with the fields parameter or submitted in the request. Fields with no stored value are omitted." Value type by field type: text -> string; note -> string (HTML; empty note = ""); url -> string; number -> "decimal number encoded as a string (e.g. "42.5")"; date -> "YYYY-MM-DD"; checkbox -> boolean; single select -> option object `{id,name,color,hidden,position,...}`; multi-select -> array of options; conditional choice -> `{id,name,parents[]}`; users -> array of User; records -> array of LinkedRecordNested; custom table links -> objects/arrays; worksheet -> array of cells. Syntax (v3 doc): `fields=default,custom_fields.priority`, `fields=default,custom_fields[priority,effort]`, bare `custom_fields` for all supported.

**Embedded requirements in a feature** (`RequirementCollection`): `{records:[RequirementNested], url?, has_more:bool (required), next_url?}`; "Inline collection. Capped at 25 records." Field property text: "Omitted by default. Request the field for inline records with default sub-fields, or choose sub-fields (e.g., ?fields=requirements[default]). Capped at 25 records. Only available on the top-level resource." Official doc examples: `fields=id,requirements[id,name]` and `requirements[default,assigned_to_user]`. Requirement default fields: id, html_url, url, name, reference_num. So full text: `GET /api/v3/features/PROJ-1?fields=default,description,custom_fields,requirements[default,description]` (my composition from the documented syntax; not an official example). Nested `description` inside a collection selection is supported by the bracket syntax, but only `feature[requirements]`-style nesting is documented as an error, so it should work; untested.

**Embedded comments in a feature** (`CommentCollection`): same shape and 25 cap; sub-fields example from the spec: `?fields=comments[default]`. CommentNested fields: id, html_url, url, body (HTML), created_at, updated_at, user, record, parent; defaults id, html_url, url, body. For author use `comments[default,created_at,user]`; user defaults: id, url, name, email. If `has_more` is true, use `next_url`/`url` (documented as full collection with pagination) — or `GET /api/v3/comments` with filters.

**Requirements list can use a feature reference number: yes (documented).** `GET /api/v3/requirements`, query `feature_id`: "ID or reference number of the feature. Limits the list to requirements in that feature." Other params: per_page (default 25, max 200), after, fields, sort.*, filter.*. Example: `/api/v3/requirements?feature_id=PROJ-1&fields=default,description,custom_fields&per_page=100` (composed). Response: `{records:[Requirement], pagination:PaginationMeta}`. Same for `GET /api/v3/features` — project_id "ID or reference prefix", release_id "ID or reference number".

**Fields strings (composed from documented syntax)**
- Feature list: `fields=default,description,status,assigned_to_user,updated_at` (omit description for lighter responses). `default` = id, html_url, url, name, reference_num.
- Requirements list: `fields=default,description,status,custom_fields`.
- Requirement description: `description` -> `{id, body}` object; HTML body.

**Pagination with projection.** The response schemas for list operations are `{records:[...], pagination: PaginationMeta}` independent of `fields`; `fields` is documented as selecting the fields of each record ("Responses include a small set of default fields when `fields` is omitted"). The docs never state explicitly that pagination is preserved under projection, but nothing documents pagination being removed; the `fields` description applies to records. Treat as schema-implied, not explicitly verified. PaginationMeta: has_more (bool), next_cursor (string|null), next_url (uri|null), truncated, truncated_message (sorted only). "When `pagination.has_more` is `true`, follow `pagination.next_url` or pass `pagination.next_cursor` as the `after` query parameter with the same filters and sort." Implementation advice: when building next requests, keep the same `fields` too (next_url presumably preserves; unverified) — safest to rebuild with `after` and same params.

**filter.contains for name — verified in spec.** Features: `name` field operators = eq, not_eq, contains, starts_with, in, not_in, empty, not_empty; `reference_num` same. Ideas: `name` same operators (also `reference_num` default). Requirements: same. Official example: `/api/v3/features?filter.contains[name]=login&filter.eq[status.name]=In%20progress`; "contains" = "Contains substring (case-insensitive)". Ideas use the same query pattern: `/api/v3/ideas?filter.contains[name]=login` (composed). Idea default fields: id, html_url, url, name, reference_num (note: Idea schema description) — differs from earlier v1 ideas.

**Remaining unverified:** real response samples; behavior of pagination/`next_url` with `fields`; whether nested `description` within `requirements[...]` returns `{id,body}`; v3 rate limits.
