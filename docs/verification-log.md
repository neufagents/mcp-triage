# Client verification log (v0.1)

Every path and config format below was checked against official documentation and/or a real
machine before release. Verification round: **2026-09-19**. If you find a path that has moved,
please open an issue — this file is the single source of truth for coverage claims.

| Client | Config location(s) | Format / key | Verified against |
|---|---|---|---|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Win) · `~/Library/Application Support/Claude/claude_desktop_config.json` (mac) · `~/.config/Claude/claude_desktop_config.json` (Linux) | JSON · `mcpServers` | Widely documented; matches real machines |
| Claude Code | `~/.claude.json` (global) · `.mcp.json` (project) | JSON · `mcpServers` | Real machine + Anthropic docs |
| Codex | `~/.codex/config.toml` | TOML · `[mcp_servers.*]` | Real machine + OpenAI docs |
| Cursor | `~/.cursor/mcp.json` (global) · `.cursor/mcp.json` (project) | JSON · `mcpServers` | Real machine + Cursor docs |
| VS Code | `%APPDATA%\Code\User\mcp.json` (Win) · `~/Library/Application Support/Code/User/mcp.json` (mac) · `~/.config/Code/User/mcp.json` (Linux) · remote/WSL: `~/.vscode-server/data/User/mcp.json` · project: `.vscode/mcp.json` | JSON · `servers` (transport named `type`) | code.visualstudio.com/docs/agents/reference/mcp-configuration; remote path: StackOverflow 79706687, microsoft/vscode#256546 |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | JSON · `mcpServers` | Windsurf docs + community reports |
| OpenClaw | `~/.openclaw/openclaw.json` (override: `OPENCLAW_CONFIG_PATH`) · `~/.config/openclaw/config.json` (legacy) | **JSON5** (comments + trailing commas are legal) · `mcp.servers` | docs.openclaw.ai/gateway/configuration, docs.openclaw.ai/tools/mcp |
| dsh (DeepSeek Harness) | `~/.dsh/profiles/*/cordis.patch.yml` · `~/.dsh/profiles/*/cordis.yml` | YAML patch entries · `name: '@deepseek-ai/dsh-mcp-client'` + `config:` | Machine-verified (profile files exist as scanned) + `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2` package README |

## dsh entry shape (as parsed)

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github          # required, [A-Za-z0-9_-]{1,32}; namespaces tools as mcp__<serverName>__<tool>
    transport: stdio            # stdio | streamable-http
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
```

Notes:
- `cordis.yml` is the profile root and is normally `[]`; user entries live in `cordis.patch.yml`
  (both are scanned — entries may also be nested under `insert:`).
- `!!js` expressions are kept as text so reference checks (`process.env.X` must exist) still run.
- `serverName` failing the required pattern is called out because the entry fails to load.

## OpenClaw specifics (as parsed)

- Config format is JSON5; comments and trailing commas are legal and NOT reported as syntax errors.
- MCP servers live under `mcp.servers`; `enabled: false` keeps a definition without connecting it —
  runtime checks are skipped for disabled entries (reported as info).
- Path resolution honors `OPENCLAW_CONFIG_PATH`.

## What is NOT covered yet (planned)

- Claude Code project-scoped `mcpServers` inside `~/.claude.json` (`projects.*.mcpServers`).
- VS Code user "profiles" (`%APPDATA%\Code\User\profiles\<id>\mcp.json`).
- GitHub Copilot Agent Host (`~/.copilot/mcp-config.json`, workspace `.mcp.json`).
- WSL filesystem for Windows-side scans (`\\wsl$\...`); run the tool inside WSL instead.
