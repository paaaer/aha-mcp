---
name: aha
description: Look up Aha! epics, features, requirements and comments by reference number or aha.io URL. Use when the user mentions an Aha reference like ABC-123 or ABC-E-123, or pastes an aha.io link.
---

# Aha! lookups

Use the read-only Aha MCP tools. Never ask the user to paste their API token into chat.

## Pick the tool from the reference

| Input | Tool |
| --- | --- |
| `ABC-E-123` or a URL containing `/epics/` | `get_aha_epic`, then `get_aha_epic_features` for its features |
| `ABC-123` or a URL containing `/features/` | `get_aha_feature` |
| Requirements of a feature | `get_aha_feature_requirements` |
| Discussion on a feature | `get_aha_feature_comments` |
| Only a name or keyword | `search_aha_records` (features, requirements or ideas; name match only) |

The tools take the reference only, not the URL. Extract the reference from the last path segment of a URL.

## Workflow

1. Fetch the record. Follow links in the description only if the user asks.
2. Summarise: name, status, reason or goal, scope, acceptance criteria, and related records.
3. Descriptions are HTML; present them as plain text.
4. Page through lists with `next_cursor` only if the user needs more.

## Errors

- `AHA_TOKEN is not set`: the user must set the token in the shell that starts Copilot, then restart Copilot.
- `404`: wrong reference type (epic vs feature), a typo, or the token lacks access. Retry with the other tool before reporting.
- `401`/`403`: token invalid or lacks permission.
- Epics cannot be searched by name; ask for the reference.
