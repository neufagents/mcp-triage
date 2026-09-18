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

## Fix engine verification (2026-09-19)

`--fix` was verified end-to-end against a fabricated three-client home on Windows (Node 22):

| Case | File | Outcome |
|---|---|---|
| Comment + two trailing commas, strict-JSON client | `~/.cursor/mcp.json` | **fixed** — 1 comment stripped, 2 trailing commas removed; file re-parses (server detected); backup written |
| Comment + missing comma, strict-JSON client | `~/.codeium/windsurf/mcp_config.json` | **not-fixable** — repaired copy still invalid; nothing written |
| Valid JSON5 by design | `~/.openclaw/openclaw.json` | untouched; no findings |

Guarantees exercised: dry-run wrote nothing; `--fix --json` emits a `fixes[]` array;
a second fix of the same file kept the pristine existing backup (`backupKept: true`);
the suite is 45/45 green; the packed tarball (23 files) installed into a fresh prefix ran
`--version`, `scan`, and the library entry from the installed copy.

## Clone-and-build verification + Node version floor (2026-09-19)

The v0.1.0 release point was verified the way a fresh contributor consumes it:

- `git clone` → `npm install` (auto-runs `prepare` → `tsc` build) → **45/45 specs green** →
  `npm pack` (23 files) → global install of the tarball into a fresh prefix → `--version`, `scan`,
  and `--fix` all run from the installed copy.
- Runtime floor: on a real **Node 20.19.5** binary, `scan` and the full `--fix` flow
  (dry-run → write → backup → idempotent re-run; backup byte-preserved) pass against a fabricated
  Claude Desktop config. `engines: >=20` holds for the published package.
- Dev/test scripts run `.ts` directly and therefore need **Node 22.18+** (native type stripping) —
  also noted in the README.

## Claude Code project-scoped servers (v0.1.1, branch `feat/claude-project-scope`, 2026-09-19)

`~/.claude.json` keeps project-scoped servers under `projects.<path>.mcpServers`; v0.1.1 extracts
them alongside the user-scoped bag.

- Fabricated-home E2E (Windows, Node 22.23): 1 user-scoped + 3 project-scoped definitions across
  3 projects → all surfaced with a coverage note (`3 project-scoped server(s) from 3 project(s)`);
  findings carry `context` (e.g. `project: /work/alpha`); identical definitions across projects
  are merged (`projects: /work/alpha, /work/beta`); drift wording distinguishes clients vs places.
- Real-machine scan (same box): one previously-invisible project-scoped server (an http transport
  under `projects["D:/HermesWorkSpace"]`) is now included; scan stays clean (no new findings).
- Suite grew 45 → **50/50 green**; `tsc` build green; `--json` exposes `note` + `context`.

## What is NOT covered yet (planned)

- VS Code user "profiles" (`%APPDATA%\Code\User\profiles\<id>\mcp.json`).
- GitHub Copilot Agent Host (`~/.copilot/mcp-config.json`, workspace `.mcp.json`).
- WSL filesystem for Windows-side scans (`\\wsl$\...`); run the tool inside WSL instead.
