// Config parsers. JSON: full. TOML: minimal (codex-style [mcp_servers.*] tables). YAML: light (dsh cordis profiles).
// Partial parsers set `caveat` and stay honest in the report.

import fs from 'node:fs';
import type { Diagnostic, DiscoveredFile, ParsedConfig, ServerEntry } from './types.ts';

export function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ---------- JSON ----------

export function findTrailingComma(text: string): { line: number; snippet: string } | null {
  const re = /,\s*[}\]]/g;
  const m = re.exec(text);
  if (!m) return null;
  const idx = m.index;
  const line = text.slice(0, idx).split('\n').length;
  const snippet = text.split('\n')[line - 1]?.trim().slice(0, 80) ?? '';
  return { line, snippet };
}

function toServerEntry(name: string, v: unknown): ServerEntry {
  const o = (v ?? {}) as Record<string, unknown>;
  const entry: ServerEntry = { name };
  if (typeof o.command === 'string') entry.command = o.command;
  if (Array.isArray(o.args)) entry.args = o.args.filter((a): a is string => typeof a === 'string');
  if (o.env && typeof o.env === 'object' && !Array.isArray(o.env)) {
    entry.env = {};
    for (const [k, val] of Object.entries(o.env as Record<string, unknown>)) {
      entry.env[k] = typeof val === 'string' ? val : undefined;
    }
  }
  if (typeof o.url === 'string') entry.url = o.url;
  if (typeof o.transport === 'string') entry.transport = o.transport;
  if (typeof o.cwd === 'string') entry.cwd = o.cwd;
  return entry;
}

/** Recognized server container shapes: mcpServers | servers | mcp.servers (first match wins). */
export function extractServersFromJson(data: unknown): ServerEntry[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const bags: unknown[] = [root.mcpServers, root.servers];
  if (root.mcp && typeof root.mcp === 'object') bags.push((root.mcp as Record<string, unknown>).servers);
  for (const bag of bags) {
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
      const out: ServerEntry[] = [];
      for (const [name, v] of Object.entries(bag as Record<string, unknown>)) out.push(toServerEntry(name, v));
      return out;
    }
  }
  return [];
}

export interface ParseOutcome {
  ok: boolean;
  servers: ServerEntry[];
  diagnostics: Diagnostic[];
  caveat?: string;
}

export function parseJsonConfig(text: string, file: string, clientId: string): ParseOutcome {
  const diagnostics: Diagnostic[] = [];
  const clean = text.replace(/^\uFEFF/, '');
  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const trailing = findTrailingComma(clean);
    if (trailing) {
      diagnostics.push({
        checkId: 'config.syntax',
        severity: 'error',
        title: 'Trailing comma breaks JSON parsing',
        detail: `line ${trailing.line}: ${trailing.snippet}`,
        hint: 'Remove the comma before the closing bracket/brace, then restart the client.',
        clientId,
        file,
        fixable: true,
      });
    } else {
      diagnostics.push({
        checkId: 'config.syntax',
        severity: 'error',
        title: 'Config file is not valid JSON',
        detail: msg,
        hint: 'Fix the syntax; most clients silently ignore a broken config file.',
        clientId,
        file,
      });
    }
    return { ok: false, servers: [], diagnostics };
  }
  const servers = extractServersFromJson(data);
  return { ok: true, servers, diagnostics: [] };
}

// ---------- TOML (minimal: [mcp_servers.*] tables) ----------

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseTomlValue(v: string): string | string[] | undefined {
  const t = v.trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    } catch {
      // fall through to lenient extraction
    }
    const items = [...t.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? '');
    return items;
  }
  return unquote(t);
}

function parseSectionHeader(line: string): string[] | null {
  const m = line.match(/^\[([^\]]+)\]\s*$/);
  if (!m) return null;
  return m[1].split('.').map((seg) => unquote(seg));
}

export function parseTomlConfig(text: string, file: string, clientId: string): ParseOutcome {
  const lines = text.split(/\r?\n/);
  const byName = new Map<string, ServerEntry>();
  let section: string[] = [];
  let sawMcpServers = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = parseSectionHeader(line);
    if (sec) {
      section = sec;
      if (sec[0] === 'mcp_servers') {
        sawMcpServers = true;
        if (sec.length >= 2) {
          const name = sec[1];
          if (!byName.has(name)) byName.set(name, { name });
        }
      }
      continue;
    }
    if (section[0] !== 'mcp_servers') continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = parseTomlValue(kv[2]);
    if (section.length === 2) {
      const entry = byName.get(section[1])!;
      if (key === 'command' && typeof value === 'string') entry.command = value;
      else if (key === 'args' && Array.isArray(value)) entry.args = value;
      else if (key === 'cwd' && typeof value === 'string') entry.cwd = value;
      else if (key === 'url' && typeof value === 'string') entry.url = value;
      else if (key === 'transport' && typeof value === 'string') entry.transport = value;
    } else if (section.length === 3 && section[2] === 'env') {
      const entry = byName.get(section[1])!;
      entry.env = entry.env ?? {};
      entry.env[key] = typeof value === 'string' ? value : undefined;
    }
  }
  const diagnostics: Diagnostic[] = [];
  if (sawMcpServers && byName.size === 0) {
    diagnostics.push({
      checkId: 'config.toml-partial',
      severity: 'info',
      title: 'mcp_servers table found but no named entries could be read',
      hint: 'Likely a parser limitation of basic TOML support — report this file to the maintainers.',
      clientId,
      file,
    });
  }
  return { ok: true, servers: [...byName.values()], diagnostics, caveat: 'toml-minimal' };
}

// ---------- YAML (light: dsh cordis profiles, @deepseek-ai/dsh-mcp-client entries) ----------

export function parseYamlLight(text: string, file: string, clientId: string): ParseOutcome {
  const servers: ServerEntry[] = [];
  const chunks = text.split(/\n(?=\s*-\s*id:)/);
  for (const chunk of chunks) {
    if (!chunk.includes('dsh-mcp-client')) continue;
    const idMatch = chunk.match(/-\s*id:\s*(\S+)/);
    const serverName = chunk.match(/serverName:\s*(.+)/)?.[1]?.trim();
    const transport = chunk.match(/transport:\s*(\S+)/)?.[1]?.trim();
    const command = chunk.match(/command:\s*(.+)/)?.[1]?.trim();
    const url = chunk.match(/url:\s*(\S+)/)?.[1]?.trim();
    const name = serverName ? unquote(serverName) : idMatch ? `dsh:${idMatch[1]}` : 'dsh-mcp-client';
    const entry: ServerEntry = { name };
    if (command) entry.command = unquote(command);
    if (url) entry.url = unquote(url);
    if (transport) entry.transport = unquote(transport);
    servers.push(entry);
  }
  return { ok: true, servers, diagnostics: [], caveat: 'yaml-light' };
}

// ---------- Entry ----------

export function parseConfigFile(f: DiscoveredFile): ParsedConfig {
  const text = readFileSafe(f.file);
  if (text === null) {
    return {
      clientId: f.clientId,
      file: f.file,
      format: f.format,
      ok: false,
      servers: [],
      diagnostics: [
        { checkId: 'config.unreadable', severity: 'error', title: 'Cannot read config file', clientId: f.clientId, file: f.file },
      ],
    };
  }
  const r =
    f.format === 'json' ? parseJsonConfig(text, f.file, f.clientId)
    : f.format === 'toml' ? parseTomlConfig(text, f.file, f.clientId)
    : parseYamlLight(text, f.file, f.clientId);
  return { clientId: f.clientId, file: f.file, format: f.format, ok: r.ok, caveat: r.caveat, servers: r.servers, diagnostics: r.diagnostics };
}
