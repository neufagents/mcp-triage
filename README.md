# MCP Triage

[![CI](https://github.com/neufagents/mcp-triage/actions/workflows/ci.yml/badge.svg)](https://github.com/neufagents/mcp-triage/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/mcp-triage.svg)](https://www.npmjs.com/package/mcp-triage) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Triage broken MCP setups across agent clients.** A [NeufAgents](https://neufagents.com) tool. One command scans the MCP configuration of every agent client on your machine, finds what is broken or fragile, explains it in plain English, and — where it is safe — repairs it.

Why *triage*: a triage assesses severity fast and routes the case — a free check-and-fix pass for the mechanical problems, and a precise hint (plus a human path) for setups that need surgery.

## What it does

- **Scans** (8 clients): Claude Desktop · Claude Code (incl. project-scoped servers from `~/.claude.json`) · Codex · Cursor · VS Code · Windsurf · OpenClaw · dsh
- **Checks** (v0.1): JSON syntax (including the classic trailing comma), Codex-style TOML tables (basic), command resolvable on PATH, missing `${VAR}` / `process.env.VAR` references, relative-path arguments, plain `http://` remote URLs, transport/entry consistency (stdio needs a command, HTTP transports need a url, `serverName` required for dsh entries), cross-client drift for same-named servers
- **Fixes** (opt-in `--fix`): mechanical repairs, only for files that fail to parse — strips JSON comments and trailing commas, re-verifies the result, keeps a `.mcp-triage.bak` backup. Everything else is escalated with a hint, never guessed at.
- **JSON5-aware**: OpenClaw's `openclaw.json` is JSON5 (comments + trailing commas legal) and is parsed as such — no false syntax errors
- **CLI-first**: runs even when your client cannot start — that is exactly when you need it
- **Zero runtime dependencies**

## Usage

```bash
npx mcp-triage            # scan standard locations (all clients) + project configs in cwd
npx mcp-triage --json     # machine-readable output
npx mcp-triage --file ./my-config.json
npx mcp-triage --fix              # repair files that fail to parse (comments / trailing commas)
npx mcp-triage --fix --dry-run    # show what --fix would do; write nothing
```

Exit codes: `0` = no error findings, `1` = at least one error finding (post-fix when `--fix` is used).

### `--fix` semantics (v0.1)

- Only files that **fail to parse** are fix candidates; healthy files are never rewritten.
- Repairs are mechanical deletions only (comments, trailing commas). A repaired copy must parse as JSON or **nothing is written**.
- Before the first write the original is saved as `<file>.mcp-triage.bak` (an existing backup is kept, never overwritten — so the pristine version survives repeated runs).

## Example output

A demo machine with three clients — one broken JSON, one unrunnable command, one healthy config:

```
$ npx mcp-triage scan

MCP Triage v0.1.0 — scanned 3 config file(s)

  ✗ Claude Desktop — ~/AppData/Roaming/Claude/claude_desktop_config.json — 0 server(s)
  ✓ Codex — ~/.codex/config.toml — 2 server(s)  (toml-minimal)
  ✓ Cursor — ~/.cursor/mcp.json — 1 server(s)

Findings (4):
  [ERROR] config.syntax — Claude Desktop: Trailing comma breaks JSON parsing
           line 5: "args": ["-y", "@modelcontextprotocol/server-memory"],
           → Remove the comma before the closing bracket/brace, then restart the client.
  [ERROR] server.command-unresolvable — Codex · "notes-mcp": command "my-notes-mcp" not found on PATH
           → This is the #1 cause of "server silently missing" bugs. Common causes: nvm-managed node (the client does not load your shell profile), missing pnpm/uv, or a typo. Use an absolute path or install the runtime the client can see.
  [WARN ] server.relative-path-arg — Codex · "notes-mcp": Relative path argument "./notes" may resolve from the wrong directory
           → Clients spawn servers from their own working directory. Use an absolute path to make this stable.
  [INFO ] config.cross-client-drift — Codex · "filesystem": Server "filesystem" is configured differently across 2 clients
           codex → ~/.codex/config.toml
           cursor → ~/.cursor/mcp.json
           → Drift is not always wrong — but when one client works and another does not, this is where to look.

Summary: 2 error(s), 1 warning(s), 1 info — 3 server(s) across 3 file(s).
```

`--fix` takes care of the mechanical class — and nothing else:

```
$ npx mcp-triage --fix

Fix results:
  [FIXED] Claude Desktop — ~/AppData/Roaming/Claude/claude_desktop_config.json: removed 1 trailing comma
           → backup: ~/AppData/Roaming/Claude/claude_desktop_config.json.mcp-triage.bak

Summary: 1 error(s), 1 warning(s), 1 info — 4 server(s) across 3 file(s).
```

*Sample output from a demo machine; home paths shortened for readability. `--fix --dry-run` prints the same report with `[DRY]` instead of `[FIXED]`, and writes nothing.*

## Coverage notes & known limitations (v0.1)

- All 8 client paths are verified against official docs and/or a real machine (verification log: `docs/verification-log.md` in the repo). OpenClaw paths additionally honor `OPENCLAW_CONFIG_PATH`; VS Code includes the remote/WSL user config (`~/.vscode-server/data/User/mcp.json`).
- JSON clients: full parsing (OpenClaw: JSON5-light — comments and trailing commas; exotic JSON5 beyond that still fails). TOML (Codex): **basic** — `[mcp_servers.*]` tables only. YAML (dsh cordis profiles): **light** — per-entry extraction of `@deepseek-ai/dsh-mcp-client` patch entries (serverName, transport, command, args, env, cwd; `!!js` expressions kept as text for reference checks).
- Claude Code project-scoped `mcpServers` inside `~/.claude.json` (`projects.*.mcpServers`) are scanned too — identical definitions across projects are merged into one entry whose context lists the projects, and findings carry the project path.
- `--file` on a file we cannot attribute to a client: if it only parses as JSON5, you get an **info** saying so (not an error) — strict-JSON clients would reject such a file.

## When `--fix` is not enough

`--fix` covers the mechanical class — for free. For everything else (a client that still refuses to start after a clean scan, a setup you want hardened before it breaks, a migration across machines), [NeufAgents](https://neufagents.com) offers a paid fix service: send your triage report to `hi@neufagents.com` and you get a written scope before any work starts. Fully async, no calls.

## Development

```bash
npm install
npm test          # node:test, 50 specs — dev/test scripts need Node 22.18+ (native type stripping)
npm run build     # tsc → dist/
node src/cli.ts scan
node src/cli.ts scan --fix --dry-run
```

The dev and test scripts import `.ts` files directly, so they need Node 22.18+. The published package
itself supports Node 20+ (`engines`) and its `scan` / `--fix` flows are smoke-tested on Node 20.19.

CI runs the full spec suite on Node 22 and a build + `--version` smoke on Node 20 on every push and pull request.

The package is ESM with zero runtime dependencies; `src/index.ts` is the library entry
(`import { discoverFiles, parseConfigFile, runChecks, applyFixes } from 'mcp-triage'`),
`src/cli.ts` is the `mcp-triage` binary. `prepack` builds `dist/`; `prepublishOnly` runs the specs.

## License

MIT © NeufAgents (neufagents.com)
