---
name: aha
description: Look up and search Aha! workspaces, releases, epics, features, requirements, ideas, initiatives, goals, notes, and tasks by reference number, aha.io URL, or name. Use whenever the user mentions an Aha reference (like ABC-123, ABC-E-123, ABC-R-12, ABC-123-1, ABC-I-5) or pastes an aha.io link, or asks about Aha workspaces or releases.
---

# Aha! lookups

Use the read-only Aha MCP tools. Never ask the user to paste their API token into chat.

## Automatic routing from Aha IDs and URLs

Aha reference numbers encode the record type (`PREFIX` is the workspace prefix, e.g. `ABC`):

| Reference pattern | Web URL path | Record type | Primary tool | Follow-up tools |
| --- | --- | --- | --- | --- |
| Any Aha ID or `https://*.aha.io/...` link | any | auto-detected | `get_aha_record` | see row below for children |
| `PREFIX` (e.g. `ABC`) | `/projects/ABC`, `/products/ABC` | Workspace | `get_aha_record` or `get_aha_workspace` | `list_aha_releases`, `search_aha_records` (with `workspace`) |
| `PREFIX-R-123` (or `-L-123`) | `/releases/...` | Release | `get_aha_record` or `get_aha_release` | `get_aha_release_features` (`features` or `epics`) |
| `PREFIX-RP-123` | `/release_phases/...` | Release phase | `get_aha_record` | — |
| `PREFIX-E-123` | `/epics/...` | Epic | `get_aha_record` or `get_aha_epic` | `get_aha_epic_features` |
| `PREFIX-123` | `/features/...`, `/activities/...` | Feature | `get_aha_record` or `get_aha_feature` | `get_aha_feature_requirements`, `get_aha_feature_comments` |
| `PREFIX-123-1` | `/requirements/...` | Requirement | `get_aha_record` | — |
| `PREFIX-I-123` | `/ideas/ideas/...`, `/ideas/...` | Idea | `get_aha_record` | — |
| `PREFIX-S-123` | `/initiatives/...` | Initiative | `get_aha_record` | — |
| `PREFIX-G-123` | `/goals/...`, `/strategic_imperatives/...` | Goal | `get_aha_record` | — |
| `PREFIX-N-123` | `/pages/...`, `/documents/...` | Note / Document | `get_aha_record` | — |
| `PREFIX-TODO-123` / `PREFIX-T-123` | `/tasks/...` | Task / To-do | `get_aha_record` | — |

All record tools accept either the reference (`ABC-E-123`) or a full `https://<subdomain>.aha.io/...` URL (including `?drawer=...` links). When in doubt, call `get_aha_record` — it parses the ID or URL and calls the right endpoint automatically.

Note the difference between `PREFIX-123-1` (digits in the middle = requirement `#1` of feature `PREFIX-123`) and `PREFIX-N-123` (letter `N` = Knowledge/Note document).

## Searching & browsing

- **Workspaces:** `list_aha_workspaces` (all workspaces, or filter by `query` name / `prefix`).
- **Releases:** `list_aha_releases` (filter by `workspace`, `query` name, and/or `parking_lot`).
- **Records by name:** `search_aha_records` (`features`, `epics`, `requirements`, `ideas`, `releases`, `workspaces`, `initiatives`, `goals`, `documents`, `tasks`; optional `workspace` scope; substring match on name, not full-text).

## Workflow

1. Fetch the record with `get_aha_record` (or the dedicated tool). Fetch child items (`get_aha_epic_features`, `get_aha_release_features`, `get_aha_feature_requirements`, `get_aha_feature_comments`) when relevant to the user's question.
2. Summarize: name, reference, workspace/release/epic context, status, dates, goal/description, and acceptance criteria.
3. Descriptions and comments are HTML; present them cleanly as plain text/Markdown.
4. Page through lists with `next_cursor` (`after`) only when more items are needed.

## Errors

- `AHA_TOKEN is not set` / `AHA_BASE_URL is not set`: the user must set the variable in the shell/environment before starting Copilot, then restart Copilot.
- `404`: typo in the reference, or the token lacks access to that workspace/record.
- `401`/`403`: token invalid or lacks API/record permission.
