// src/serve.ts — MCP server mode: run mcp-triage as a stdio MCP server.
//
// The MCP stdio transport is newline-delimited JSON-RPC 2.0 — spoken directly here to
// keep the package at zero runtime dependencies. The server exposes the same pipeline
// as the CLI:
//   - triage_scan : read-only scan (discovery + checks + cross-client drift)
//   - triage_fix  : mechanical repairs (dry-run by default; parse-gated writes + backup)
//
// stdout carries protocol messages only; all logging goes to stderr.

import path from 'node:path';
import { createInterface } from 'node:readline';
import { discoverFiles } from './discover.ts';
import { parseConfigFile } from './parse.ts';
import { runChecks, checkCrossClientDrift, DEFAULT_CHECK_CONTEXT } from './checks.ts';
import { applyFixes } from './fix.ts';
import { renderHuman } from './report.ts';
import { VERSION } from './version.ts';
import type { Diagnostic, DiscoveredFile, FixOutcome, Format, ParsedConfig } from './types.ts';

export const SERVER_NAME = 'mcp-triage';

// Protocol revisions this server is prepared to speak. The implemented surface
// (initialize / ping / tools) is identical across these revisions; newer requests are
// answered with the newest supported revision so the client can negotiate down.
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const FALLBACK_PROTOCOL = '2025-06-18';

// ---------- scan pipeline (same shape the CLI uses) ----------

function guessFormat(file: string): Format {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.toml') return 'toml';
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  return 'json';
}

export function collectDiagnostics(parsed: ParsedConfig[]): Diagnostic[] {
  return [
    ...parsed.flatMap((p) => p.diagnostics),
    ...runChecks(parsed, DEFAULT_CHECK_CONTEXT),
    ...checkCrossClientDrift(parsed),
  ];
}

export interface ScanOutcome {
  files: DiscoveredFile[];
  parsed: ParsedConfig[];
  diagnostics: Diagnostic[];
  fixes?: FixOutcome[];
}

function filesFor(opts: { cwd?: string; file?: string }): DiscoveredFile[] {
  if (opts.file) {
    const f = path.resolve(opts.file);
    return [{ clientId: 'custom', file: f, format: guessFormat(f), scope: 'project', json5Fallback: true }];
  }
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  return discoverFiles(cwd);
}

export function runScan(opts: { cwd?: string; file?: string } = {}): ScanOutcome {
  const files = filesFor(opts);
  const parsed = files.map(parseConfigFile);
  return { files, parsed, diagnostics: collectDiagnostics(parsed) };
}

export function runFix(opts: { cwd?: string; file?: string; dryRun?: boolean } = {}): ScanOutcome {
  const scan = runScan(opts);
  const fixes = applyFixes(scan.files, scan.parsed, { dryRun: opts.dryRun !== false });
  if (fixes.some((r) => r.status === 'fixed')) {
    const parsed = scan.files.map(parseConfigFile); // re-read what is now on disk
    return { files: scan.files, parsed, diagnostics: collectDiagnostics(parsed), fixes };
  }
  return { ...scan, fixes };
}

// ---------- tool definitions ----------

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'triage_scan',
    title: 'Triage MCP configs (read-only)',
    description:
      'Scan the MCP configuration files of the agent clients on this machine (Claude Desktop, Claude Code, Codex, Cursor, VS Code, Windsurf, OpenClaw, dsh) and report findings: broken JSON/TOML, commands not on PATH, missing env vars, relative-path arguments, plain-http remotes, transport mismatches, and cross-client drift for same-named servers. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Scan this single config file instead of the standard locations.' },
        cwd: {
          type: 'string',
          description: 'Directory whose project-level configs are included (default: the server process working directory).',
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Triage MCP configs', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'triage_fix',
    title: 'Repair mechanical config problems',
    description:
      'Repair MCP config files that fail to parse — mechanical repairs only (strip JSON comments and trailing commas). Dry-run by default: unless dry_run is explicitly false, nothing is written. A .mcp-triage.bak backup is kept before any write, and nothing is written unless the repaired copy parses cleanly.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Fix this single config file instead of the standard locations.' },
        cwd: {
          type: 'string',
          description: 'Directory whose project-level configs are included (default: the server process working directory).',
        },
        dry_run: { type: 'boolean', description: 'When true (the default), report what would be fixed and write nothing.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Repair mechanical config problems', readOnlyHint: false, openWorldHint: false },
  },
];

const INSTRUCTIONS =
  'Client-side MCP config triage. triage_scan is read-only and reports broken or fragile configuration across the local agent clients; ' +
  'triage_fix repairs the mechanical class (JSON comments / trailing commas) with a backup and dry-run default. ' +
  'Everything else is reported with a hint, never guessed at. Both tools run on the machine where this server runs.';

// ---------- JSON-RPC / MCP handling ----------

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const ok = (id: string | number | null, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: string | number | null, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Handle one decoded JSON-RPC message. Returns the response to send, or null for notifications. */
export async function handleMessage(raw: unknown): Promise<RpcResponse | null> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return rpcError(null, -32600, 'Invalid Request');
  }
  const msg = raw as RpcRequest;
  const id = msg.id ?? null;
  const hasId = msg.id !== undefined && msg.id !== null;
  const method = typeof msg.method === 'string' ? msg.method : '';
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;

  switch (method) {
    case 'initialize': {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : FALLBACK_PROTOCOL;
      const clientInfo = params.clientInfo as { name?: string; version?: string } | undefined;
      process.stderr.write(
        `mcp-triage serve: initialize (client=${clientInfo?.name ?? 'unknown'} ${clientInfo?.version ?? ''}; protocol=${requested || 'none'} -> ${protocolVersion})\n`,
      );
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS });

    case 'tools/call': {
      const name = asString(params.name);
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      if (name === 'triage_scan') {
        const out = runScan({ cwd: asString(args.cwd), file: asString(args.file) });
        return ok(id, { content: [{ type: 'text', text: renderHuman(out, VERSION) }], isError: false });
      }
      if (name === 'triage_fix') {
        const out = runFix({ cwd: asString(args.cwd), file: asString(args.file), dryRun: args.dry_run !== false });
        return ok(id, { content: [{ type: 'text', text: renderHuman(out, VERSION, out.fixes) }], isError: false });
      }
      return rpcError(id, -32602, `Unknown tool: ${name ?? '(none)'}`);
    }

    // Everything below is defensive compatibility: these capabilities are not advertised,
    // but a well-behaved conservative answer beats an error for introspection clients.
    case 'resources/list':
      return ok(id, { resources: [] });
    case 'prompts/list':
      return ok(id, { prompts: [] });
    case 'logging/setLevel':
      return ok(id, {});

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return null;

    default:
      if (!hasId) return null; // unknown notification — ignore silently
      return rpcError(id, method === '' ? -32600 : -32601, method === '' ? 'Invalid Request' : `Method not found: ${method}`);
  }
}

/** Run the stdio server: read newline-delimited JSON-RPC on stdin, write responses to stdout. */
export function runServer(): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const respond = (res: RpcResponse | null): void => {
    if (res !== null) process.stdout.write(JSON.stringify(res) + '\n');
  };

  let chain: Promise<void> = Promise.resolve();
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    chain = chain.then(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        respond(rpcError(null, -32700, 'Parse error'));
        return;
      }
      try {
        respond(await handleMessage(parsed));
      } catch (e) {
        const m = parsed as RpcRequest | null;
        const hasId = !!m && typeof m === 'object' && m.id !== undefined && m.id !== null;
        process.stderr.write(`mcp-triage serve: internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
        if (hasId) respond(rpcError((m as RpcRequest).id ?? null, -32603, 'Internal error'));
      }
    });
  });

  process.stderr.write(`mcp-triage serve v${VERSION} — stdio MCP server ready (newline-delimited JSON-RPC; tools: triage_scan, triage_fix)\n`);
}
