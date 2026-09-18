#!/usr/bin/env node
// mcp-triage CLI — v0.1
// Usage: mcp-triage [scan] [--file <path>] [--cwd <dir>] [--json] [--fix [--dry-run]] [--version] [--help]

import path from 'node:path';
import { discoverFiles } from './discover.ts';
import { parseConfigFile } from './parse.ts';
import { runChecks, checkCrossClientDrift, DEFAULT_CHECK_CONTEXT } from './checks.ts';
import { applyFixes } from './fix.ts';
import { renderHuman, renderJson } from './report.ts';
import { VERSION } from './version.ts';
import type { Diagnostic, DiscoveredFile, FixOutcome, Format, ParsedConfig } from './types.ts';

function help(): string {
  return `mcp-triage v${VERSION} — triage broken MCP setups across agent clients

Usage:
  mcp-triage [scan]              Scan standard config locations (all clients) + current dir project configs
  mcp-triage scan --file <path>  Scan a single config file
  mcp-triage scan --cwd <dir>    Also check project-level configs relative to <dir>
  mcp-triage scan --json         Machine-readable output

Fix mode (opt-in):
  mcp-triage scan --fix            Repair config files that fail to parse (mechanical repairs only:
                                   JSON comments / trailing commas). A .mcp-triage.bak backup is
                                   written before any change, and nothing is written unless the
                                   repaired copy parses cleanly.
  mcp-triage scan --fix --dry-run  Show what --fix would do; write nothing.

Exit codes: 0 = no error findings, 1 = at least one error finding (post-fix when --fix is used).
`;
}

function guessFormat(file: string): Format {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.toml') return 'toml';
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  return 'json';
}

function collectDiagnostics(parsed: ParsedConfig[]): Diagnostic[] {
  return [
    ...parsed.flatMap((p) => p.diagnostics),
    ...runChecks(parsed, DEFAULT_CHECK_CONTEXT),
    ...checkCrossClientDrift(parsed),
  ];
}

const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-V')) {
  console.log(VERSION);
  process.exit(0);
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(help());
  process.exit(0);
}

const json = argv.includes('--json');
const fix = argv.includes('--fix');
const dryRun = argv.includes('--dry-run');

let cwd = process.cwd();
const cwdIdx = argv.indexOf('--cwd');
if (cwdIdx >= 0 && argv[cwdIdx + 1]) cwd = path.resolve(argv[cwdIdx + 1]);

const fileIdx = argv.indexOf('--file');
let files: DiscoveredFile[];
if (fileIdx >= 0 && argv[fileIdx + 1]) {
  const f = path.resolve(argv[fileIdx + 1]);
  files = [{ clientId: 'custom', file: f, format: guessFormat(f), scope: 'project', json5Fallback: true }];
} else {
  files = discoverFiles(cwd);
}

let parsed = files.map(parseConfigFile);
let diagnostics = collectDiagnostics(parsed);

let fixes: FixOutcome[] | undefined;
if (fix) {
  fixes = applyFixes(files, parsed, { dryRun });
  if (fixes.some((r) => r.status === 'fixed')) {
    parsed = files.map(parseConfigFile); // re-read what is now on disk
    diagnostics = collectDiagnostics(parsed);
  }
}

const input = { files, parsed, diagnostics };
console.log(json ? renderJson(input, VERSION, fixes) : renderHuman(input, VERSION, fixes));

if (diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1;
