# Aha! plugin for GitHub Copilot CLI

Read-only access to [Aha!](https://www.aha.io) from Copilot CLI. The plugin
bundles:

- a local **MCP server** that reads epics, features, requirements and comments
  through the Aha! REST API v3, and
- an **`aha` skill** that tells Copilot which tool to use for which kind of
  reference (for example `ABC-123` vs. `ABC-E-123`).

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

## Tools

| Tool                           | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `get_aha_feature`              | Feature by reference or ID, with description, status and custom fields  |
| `get_aha_feature_requirements` | Paginated requirements with descriptions and custom fields              |
| `get_aha_feature_comments`     | First 25 comments (`has_more` indicates there are more in Aha!)         |
| `get_aha_epic`                 | Epic by reference (e.g. `ABC-E-123`), with description, status and custom fields |
| `get_aha_epic_features`        | Paginated features that belong to an epic                               |
| `search_aha_records`           | Case-insensitive name search in features, requirements or ideas (one type at a time; not full-text; epics are not searchable) |

Notes:

- Epic references contain `-E-` and live under `/epics/` in Aha! URLs. Use
  `get_aha_epic` for those; `get_aha_feature` returns 404 for them.
- The tools take the reference only, not a full URL.
- List tools return `pagination.next_cursor` when more results exist; pass it as
  `after` with the same parameters.
- Descriptions may be HTML. Long text fields are truncated and marked, and
  oversized responses are rejected with a hint to reduce `per_page`.
- Acceptance criteria may be in the description, custom fields or requirements.

Example prompts:

```text
Show Aha epic ABC-E-123 and list its features.
Summarize feature ABC-123, including requirements and acceptance criteria.
Compare the requirements of ABC-123 with this repository and distinguish
implemented, missing and uncertain parts.
Search Aha features with "account refresh" in the name.
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
