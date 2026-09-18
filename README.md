# MCP Triage

> **Pre-release — v0.1.0, not yet published to npm.** Repo under construction.

**Triage broken MCP setups across agent clients.** One command scans the MCP configuration of every agent client on your machine, finds what is broken or fragile, explains it in plain English, and points to the fix.

Why *triage*: a triage assesses severity fast and routes the case — free checks for the issues you can fix yourself, and a human path for setups that need surgery.

## What it does

- **Scans** (8 clients): Claude Desktop · Claude Code · Codex · Cursor · VS Code · Windsurf · OpenClaw · dsh
- **Checks** (v0.1): JSON syntax (including the classic trailing comma), Codex-style TOML tables (basic), command resolvable on PATH, missing `${VAR}` references, relative-path arguments, plain `http://` remote URLs, cross-client drift for same-named servers
- **CLI-first**: runs even when your client cannot start — that is exactly when you need it
- **Zero runtime dependencies**

## Usage

```bash
npx mcp-triage            # scan standard locations (all clients) + project configs in cwd
npx mcp-triage --json     # machine-readable output
npx mcp-triage --file ./my-config.json
```

Exit codes: `0` = no error findings, `1` = at least one error finding.

## Coverage notes & known limitations (v0.1)

- JSON clients: full parsing. TOML (Codex): **basic** — `[mcp_servers.*]` tables only. YAML (dsh cordis profiles): **light** — line-based extraction of `@deepseek-ai/dsh-mcp-client` entries.
- Claude Code project-scoped `mcpServers` inside `~/.claude.json` (`projects.*.mcpServers`) are **not yet scanned** (v0.1.1).
- VS Code / OpenClaw / dsh paths are pending a docs verification pass before release.

## Development

```bash
npm install
npm test          # node:test, 16 specs
npm run build     # tsc → dist/
node src/cli.ts scan
```

## License

MIT © NeufAgents (neufagents.com)
