# Aha! plugin for GitHub Copilot CLI

Read-only access to [Aha!](https://www.aha.io) from Copilot CLI. The plugin
bundles:

- a local **MCP server** that reads and searches workspaces, releases, epics,
  features, requirements, ideas, initiatives, goals, documents/notes, tasks and
  comments through the Aha! REST API v3, and
- an **`aha` skill** plus automatic ID/URL detection so Copilot knows which
  record type and endpoint to use whenever you paste an Aha! reference (such as
  `ABC-123`, `ABC-E-123`, `ABC-R-12`, `ABC-123-1`, or `ABC`) or an `aha.io`
  link.

The server runs as a local Node.js process over MCP STDIO and opens no port. It
only performs HTTPS `GET` requests, and Aha! enforces the permissions of the
token owner.

## Requirements

- GitHub Copilot CLI
- Node.js 20 or later
- An Aha! API token for your own user (Aha!: *Settings > Personal > Developer >
  API key*)

## Install

```powershell
copilot plugin marketplace add paaaer/aha-mcp
copilot plugin install aha@aha-tools
```

No `npm install` or build step is needed: the repository ships a prebuilt,
self-contained bundle (`dist/aha-mcp.mjs`).

Update later with `copilot plugin update aha`.

## Configure

The server reads two environment variables from the shell that starts Copilot.
Nothing secret is stored in the plugin or in any configuration file.

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `AHA_BASE_URL` | Your Aha! account origin, e.g. `https://<company>.aha.io` (HTTPS, no path) |
| `AHA_TOKEN`    | Your personal Aha! API token                             |

PowerShell:

```powershell
$env:AHA_BASE_URL = 'https://<company>.aha.io'
$secure = Read-Host 'Aha API token' -AsSecureString
$env:AHA_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
Remove-Variable secure
copilot
```

bash/zsh:

```bash
export AHA_BASE_URL='https://<company>.aha.io'
read -rs -p 'Aha API token: ' AHA_TOKEN && export AHA_TOKEN
copilot
```

Environment changes only take effect in a new Copilot process. Never paste the
token into chat or commit it.

### Make the variables permanent (optional)

To avoid setting them in every shell, store them in your user environment.

PowerShell (Windows):

```powershell
[Environment]::SetEnvironmentVariable('AHA_BASE_URL', 'https://<company>.aha.io', 'User')
$secure = Read-Host 'Aha API token' -AsSecureString
[Environment]::SetEnvironmentVariable('AHA_TOKEN', [System.Net.NetworkCredential]::new('', $secure).Password, 'User')
Remove-Variable secure
```

Open a new terminal afterwards; shells that are already open don't see the
change. Check with `[bool]$env:AHA_TOKEN` (prints `True`).

bash/zsh: add `export AHA_BASE_URL=...` and `export AHA_TOKEN=...` to your
shell profile, with the file readable only by you.

Trade-off: the token is then stored in plain text in your user environment and
is readable by every program you run. Prefer the per-shell approach above on
shared machines. Avoid typing the token directly into a command, because it
ends up in the shell history.

## Tools

| Tool                           | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `get_aha_record`               | Universal lookup by any Aha! reference (`ABC-123`, `ABC-E-123`, `ABC-R-12`, `ABC`, etc.) or `aha.io` URL — auto-detects the record type |
| `list_aha_workspaces`          | List or search Aha! workspaces by name or reference prefix              |
| `get_aha_workspace`            | Workspace details, hierarchy, description and custom fields             |
| `list_aha_releases`            | List or search releases (optionally scoped to a workspace or parking lot) |
| `get_aha_release`              | Release details, dates, status, phases, description and custom fields   |
| `get_aha_release_features`     | Paginated features or epics planned in a release                        |
| `get_aha_epic`                 | Epic details, dates, status, description and custom fields              |
| `get_aha_epic_features`        | Paginated features that belong to an epic                               |
| `get_aha_feature`              | Feature details, status, epic/release context, description and custom fields |
| `get_aha_feature_requirements` | Paginated requirements of a feature with descriptions and custom fields |
| `get_aha_feature_comments`     | First 25 comments on a feature (`has_more` indicates more in Aha!)      |
| `search_aha_records`           | Case-insensitive name substring search across features, epics, requirements, ideas, releases, workspaces, initiatives, goals, documents, or tasks (optionally scoped to a workspace) |

### Automatic Aha! ID & URL detection

All record tools accept either a reference number or a full `https://<company>.aha.io/...` URL (including board `?drawer=...` URLs). `get_aha_record` automatically routes based on Aha!'s reference naming conventions:

| Reference format | Record type |
| ---------------- | ----------- |
| `ABC` | Workspace (product / line / team) |
| `ABC-R-123` / `ABC-L-123` | Release / Parking lot |
| `ABC-RP-123` | Release phase |
| `ABC-E-123` | Epic |
| `ABC-123` | Feature / Activity |
| `ABC-123-1` | Requirement |
| `ABC-I-123` | Idea |
| `ABC-S-123` | Initiative |
| `ABC-G-123` | Goal |
| `ABC-N-123` | Document / Note |
| `ABC-TODO-123` / `ABC-T-123` | Task / To-do |

Notes:

- List tools return `pagination.next_cursor` when more results exist; pass it as
  `after` with the same parameters.
- `search_aha_records` matches record names (substring), not full-text body content.
- Descriptions may be HTML. Long text fields are truncated and marked, and
  oversized responses are rejected with a hint to reduce `per_page`.
- Acceptance criteria may be in the description, custom fields or requirements.

Example prompts:

```text
ABC-E-123 — summarize this epic and list its features.
What is planned in release ABC-R-12?
List our Aha workspaces matching "platform" and show upcoming releases.
Summarize https://<company>.aha.io/features/ABC-123 including requirements and acceptance criteria.
Compare the requirements of ABC-123 with this repository and distinguish implemented, missing and uncertain parts.
```

## Security and privacy

- The token is only read from the environment and is sent only to
  `AHA_BASE_URL` over HTTPS. Redirects are rejected so credentials are never
  forwarded.
- The server is read-only, but Aha! API tokens may have write privileges, so
  treat the token as a secret.
- Aha! content you retrieve is sent to the model Copilot uses. Check your
  organization's data policies first, and treat Aha! records as untrusted data,
  not instructions.

## Troubleshooting

| Symptom                                  | Cause / fix |
| ---------------------------------------- | ----------- |
| `AHA_TOKEN is not set` / `AHA_BASE_URL is not set` | Set the variable in the shell **before** starting Copilot, then restart Copilot. |
| `Aha request failed or timed out`        | Check network access and that `AHA_BASE_URL` is correct. |
| `401`                                    | Invalid token. |
| `403`                                    | Your user lacks API or record access. |
| `404`                                    | Wrong reference, no access, or wrong record type (epic vs. feature). |
| `429`                                    | Rate limited; wait and retry. |
| Server not listed                        | Run `/mcp list` in Copilot (the server is named `aha`), then `/mcp reload`. Check that organization policy allows local MCP servers. |

`copilot mcp get aha` shows the server configuration (not live status).

## Repository layout

```text
plugin.json                      Plugin manifest (Agent Plugins 1.0)
mcp.json                         MCP server definition (runs dist/aha-mcp.mjs)
skills/aha/SKILL.md              Skill describing how to look up Aha! records
.github/plugin/marketplace.json  Marketplace catalog (aha-tools)
src/                             TypeScript source for the MCP server
dist/aha-mcp.mjs                 Committed, self-contained bundle used by installs
test/                            Tests (no network or token needed)
docs/aha-api-research.md         Notes on the Aha! REST API
```

## Development

```powershell
npm ci
npm test          # type-check/build and run the tests
npm run bundle    # rebuild dist/aha-mcp.mjs
```

Installs use the committed bundle, so after changing `src/` run
`npm test && npm run bundle`, commit `dist/aha-mcp.mjs`, and bump `version` in
`plugin.json` and `.github/plugin/marketplace.json`.

To run the server without the plugin, build it and add a local server to
`~/.copilot/mcp-config.json` that runs `node` with the absolute path to
`build/index.js` and `AHA_BASE_URL` in its `env`; keep the token in your shell.

## License

MIT, see [LICENSE](LICENSE).
