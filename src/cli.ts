#!/usr/bin/env node
// mcp-triage CLI — v0.1
// Usage: mcp-triage [scan] [--file <path>] [--cwd <dir>] [--json] [--version] [--help]

import path from 'node:path';
import { discoverFiles } from './discover.ts';
import { parseConfigFile } from './parse.ts';
import { runChecks, checkCrossClientDrift, DEFAULT_CHECK_CONTEXT } from './checks.ts';
import { renderHuman, renderJson } from './report.ts';
import { VERSION } from './version.ts';
import type { DiscoveredFile, Format } from './types.ts';

function help(): string {
  return `mcp-triage v${VERSION} — triage broken MCP setups across agent clients

Usage:
  mcp-triage [scan]              Scan standard config locations (all clients) + current dir project configs
  mcp-triage scan --file <path>  Scan a single config file
  mcp-triage scan --cwd <dir>    Also check project-level configs relative to <dir>
  mcp-triage scan --json         Machine-readable output

Exit codes: 0 = no errors, 1 = at least one error finding.
`;
}

function guessFormat(file: string): Format {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.toml') return 'toml';
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  return 'json';
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

const parsed = files.map(parseConfigFile);
const diagnostics = [
  ...parsed.flatMap((p) => p.diagnostics),
  ...runChecks(parsed, DEFAULT_CHECK_CONTEXT),
  ...checkCrossClientDrift(parsed),
];

const input = { files, parsed, diagnostics };
console.log(json ? renderJson(input, VERSION) : renderHuman(input, VERSION));

if (diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1;
