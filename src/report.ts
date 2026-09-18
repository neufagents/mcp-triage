// Report rendering: human-readable (default) and --json.

import os from 'node:os';
import { CLIENTS } from './clients.ts';
import type { Diagnostic, DiscoveredFile, FixOutcome, ParsedConfig, Severity } from './types.ts';

export interface ReportInput {
  files: DiscoveredFile[];
  parsed: ParsedConfig[];
  diagnostics: Diagnostic[];
}

const ORDER: Severity[] = ['error', 'warning', 'info'];
const LABEL: Record<Severity, string> = { error: 'ERROR', warning: 'WARN ', info: 'INFO ' };
const FIX_LABEL: Record<FixOutcome['status'], string> = {
  fixed: 'FIXED',
  'would-fix': 'DRY  ',
  'not-fixable': 'NOFIX',
  skipped: 'SKIP ',
};

export function tilde(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function clientName(id: string): string {
  return CLIENTS.find((c) => c.id === id)?.name ?? id;
}

export function renderHuman(input: ReportInput, version: string, fixes?: FixOutcome[]): string {
  const lines: string[] = [];
  lines.push(`MCP Triage v${version} — scanned ${input.files.length} config file(s)`);
  lines.push('');

  if (input.files.length === 0) {
    lines.push('No MCP config files found in the standard locations for: ' + CLIENTS.map((c) => c.name).join(', '));
    lines.push('If you expected one, pass a path explicitly: mcp-triage scan --file <path>');
    return lines.join('\n');
  }

  for (const p of input.parsed) {
    const flag = p.ok ? '✓' : '✗';
    const n = p.servers.length;
    const caveat = p.caveat ? `  (${p.caveat})` : '';
    lines.push(`  ${flag} ${clientName(p.clientId)} — ${tilde(p.file)} — ${n} server(s)${caveat}`);
  }
  lines.push('');

  const sorted = [...input.diagnostics].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  if (sorted.length === 0) {
    lines.push('All clear — no findings.');
  } else {
    lines.push(`Findings (${sorted.length}):`);
    for (const d of sorted) {
      const where = [clientName(d.clientId ?? ''), d.serverName ? `"${d.serverName}"` : ''].filter(Boolean).join(' · ');
      lines.push(`  [${LABEL[d.severity]}] ${d.checkId} — ${where ? where + ': ' : ''}${d.title}`);
      if (d.detail) for (const l of d.detail.split('\n')) lines.push(`           ${l}`);
      if (d.hint) lines.push(`           → ${d.hint}`);
    }
  }

  if (fixes !== undefined) {
    lines.push('');
    if (fixes.length === 0) {
      lines.push('Fix results: no repair candidates — no scanned file failed to parse.');
    } else {
      const dry = fixes.some((f) => f.status === 'would-fix');
      lines.push(dry ? 'Fix results (dry run — nothing written):' : 'Fix results:');
      for (const f of fixes) {
        const what = f.changes.length > 0 ? `: ${f.changes.join(', ')}` : '';
        lines.push(`  [${FIX_LABEL[f.status]}] ${clientName(f.clientId)} — ${tilde(f.file)}${what}`);
        if (f.reason) lines.push(`           → ${f.reason}`);
        if (f.backupPath) {
          lines.push(`           → backup: ${tilde(f.backupPath)}${f.backupKept ? ' (existing backup kept)' : ''}`);
        }
      }
    }
  }

  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of input.diagnostics) counts[d.severity]++;
  const servers = input.parsed.reduce((a, p) => a + p.servers.length, 0);
  lines.push('');
  lines.push(
    `Summary: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info — ${servers} server(s) across ${input.files.length} file(s).`,
  );
  return lines.join('\n');
}

export function renderJson(input: ReportInput, version: string, fixes?: FixOutcome[]): string {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of input.diagnostics) counts[d.severity]++;
  return JSON.stringify(
    {
      tool: 'mcp-triage',
      version,
      generatedAt: new Date().toISOString(),
      files: input.parsed.map((p) => ({
        clientId: p.clientId,
        clientName: clientName(p.clientId),
        file: p.file,
        format: p.format,
        ok: p.ok,
        caveat: p.caveat,
        servers: p.servers.map((s) => ({ name: s.name, command: s.command, url: s.url, transport: s.transport })),
      })),
      diagnostics: input.diagnostics,
      ...(fixes !== undefined ? { fixes } : {}),
      summary: { counts, servers: input.parsed.reduce((a, p) => a + p.servers.length, 0), files: input.files.length },
    },
    null,
    2,
  );
}
