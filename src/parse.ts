// Config parsers. JSON: full (+ JSON5-light for OpenClaw). TOML: minimal (codex-style [mcp_servers.*] tables).
// YAML: light (dsh cordis profiles: @deepseek-ai/dsh-mcp-client patch entries).
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

/**
 * JSON5-light normalization: strips // and block comments and trailing commas outside strings,
 * converts single-quoted strings to double-quoted, and quotes unquoted identifier keys.
 * Covers what OpenClaw documents as legal JSON5 (comments + trailing commas; the parser also
 * accepts unquoted keys). Deliberately light: exotic JSON5 beyond this (hex numbers, multiline
 * strings, +/- Infinity) is out of scope and will still fail JSON.parse.
 */
export function normalizeJson5(text: string): string {
  return quoteUnquotedKeys(stripTrailingCommas(stripCommentsAndSingleQuotes(text)));
}

/** Pass 1: strip comments; convert single-quoted strings to double-quoted. */
function stripCommentsAndSingleQuotes(text: string): string {
  let out = '';
  let inString = false;
  let quote = '"';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (quote === "'") {
        // Convert content to a double-quoted scalar.
        if (c === '\\' && i + 1 < text.length) {
          const n = text[i + 1];
          if (n === "'") out += "'";
          else out += '\\' + n;
          i++;
          continue;
        }
        if (c === "'") {
          out += '"';
          inString = false;
          continue;
        }
        if (c === '"') out += '\\"';
        else out += c;
        continue;
      }
      out += c;
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      quote = '"';
      out += c;
      continue;
    }
    if (c === "'") {
      inString = true;
      quote = "'";
      out += '"';
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // skip the closing '/'
      continue;
    }
    out += c;
  }
  return out;
}

/** Pass 2: drop trailing commas before } or ] (outside strings). Also used by the fix engine. */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue; // drop the comma
    }
    out += c;
  }
  return out;
}

/** Pass 3: quote unquoted identifier keys ({ foo: 1 } → { "foo": 1 }). Strings are double-quoted by now. */
function quoteUnquotedKeys(text: string): string {
  let out = '';
  let inString = false;
  const stack: Array<'obj' | 'arr'> = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '{') {
      stack.push('obj');
      expectKey = true;
      out += c;
      continue;
    }
    if (c === '[') {
      stack.push('arr');
      expectKey = false;
      out += c;
      continue;
    }
    if (c === '}' || c === ']') {
      stack.pop();
      expectKey = false;
      out += c;
      continue;
    }
    if (c === ',') {
      expectKey = stack[stack.length - 1] === 'obj';
      out += c;
      continue;
    }
    if (c === ':') {
      expectKey = false;
      out += c;
      continue;
    }
    if (expectKey && /[A-Za-z_$]/.test(c)) {
      let j = i;
      let tok = '';
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) {
        tok += text[j];
        j++;
      }
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === ':') {
        out += '"' + tok + '"';
        i = j - 1;
        continue;
      }
      // Not a key (e.g. a bare literal in an odd spot) — leave untouched.
      out += tok;
      i = j - 1;
      continue;
    }
    out += c;
  }
  return out;
}

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
  else if (typeof o.type === 'string' && ['stdio', 'streamable-http', 'sse', 'http'].includes(o.type.toLowerCase())) {
    entry.transport = o.type; // VS Code & co. spell the transport "type"
  }
  if (typeof o.cwd === 'string') entry.cwd = o.cwd;
  if (typeof o.enabled === 'boolean') entry.enabled = o.enabled;
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

// ---------- Claude Code project-scoped servers ----------
//
// Claude Code keeps project-scoped servers inside the same ~/.claude.json file:
//   { "projects": { "/abs/project/path": { "mcpServers": { "<name>": { ... } } } } }
// They connect only when Claude Code runs inside that directory. Identical definitions
// across projects are merged into a single entry whose `context` lists the projects;
// findings for these entries carry the project path.

export interface ClaudeProjectScope {
  servers: ServerEntry[];
  /** Number of projects that carry at least one server definition. */
  projects: number;
}

function entryShapeKey(s: ServerEntry): string {
  const envKey = s.env ? Object.entries(s.env).sort(([a], [b]) => (a < b ? -1 : 1)) : null;
  return JSON.stringify([
    s.name,
    s.command ?? null,
    s.args ?? null,
    envKey,
    s.url ?? null,
    s.transport ?? null,
    s.cwd ?? null,
    s.enabled ?? null,
  ]);
}

/** Human label for the projects an entry was found in. */
export function contextLabel(paths: string[]): string {
  if (paths.length === 1) return `project: ${paths[0]}`;
  const shown = paths.slice(0, 2).join(', ');
  const more = paths.length > 2 ? ` +${paths.length - 2} more` : '';
  return `projects: ${shown}${more}`;
}

export function extractClaudeProjectServers(data: unknown): ClaudeProjectScope {
  const empty: ClaudeProjectScope = { servers: [], projects: 0 };
  if (!data || typeof data !== 'object') return empty;
  const projects = (data as Record<string, unknown>).projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return empty;
  const byShape = new Map<string, { entry: ServerEntry; paths: string[] }>();
  let projectsWithServers = 0;
  for (const [projPath, projVal] of Object.entries(projects as Record<string, unknown>)) {
    if (!projVal || typeof projVal !== 'object' || Array.isArray(projVal)) continue;
    const bag = (projVal as Record<string, unknown>).mcpServers;
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    const names = Object.keys(bag as Record<string, unknown>);
    if (names.length === 0) continue;
    projectsWithServers++;
    for (const name of names) {
      const entry = toServerEntry(name, (bag as Record<string, unknown>)[name]);
      const key = entryShapeKey(entry);
      const hit = byShape.get(key);
      if (hit) {
        if (!hit.paths.includes(projPath)) hit.paths.push(projPath);
      } else {
        byShape.set(key, { entry, paths: [projPath] });
      }
    }
  }
  const servers: ServerEntry[] = [];
  for (const { entry, paths } of byShape.values()) {
    entry.context = contextLabel(paths);
    servers.push(entry);
  }
  return { servers, projects: projectsWithServers };
}

export interface ParseOutcome {
  ok: boolean;
  servers: ServerEntry[];
  diagnostics: Diagnostic[];
  caveat?: string;
  /** Coverage note for non-obvious extractions (e.g. project-scoped servers folded in from ~/.claude.json). */
  note?: string;
}

export function parseJsonConfig(
  text: string,
  file: string,
  clientId: string,
  opts: { json5?: boolean; json5Fallback?: boolean; projectScope?: boolean } = {},
): ParseOutcome {
  const diagnostics: Diagnostic[] = [];
  const clean = text.replace(/^\uFEFF/, '');
  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch (e) {
    if (opts.json5 || opts.json5Fallback) {
      try {
        const normalized = normalizeJson5(clean);
        data = JSON.parse(normalized);
        const servers = extractServersFromJson(data);
        if (opts.json5) {
          // The client accepts JSON5 by design (OpenClaw) — no finding.
          return { ok: true, servers, diagnostics: [], caveat: 'json5-light' };
        }
        // Unknown client (explicit --file): report exactly what we found, don't guess.
        return {
          ok: true,
          servers,
          caveat: 'json5-light',
          diagnostics: [
            {
              checkId: 'config.json5-only',
              severity: 'info',
              title: 'Valid JSON5, but not strict JSON (comments and/or trailing commas)',
              hint: 'Fine for OpenClaw (JSON5 by design). Strict-JSON clients (Claude Desktop, Cursor, VS Code, …) will reject this file — remove comments and trailing commas if it feeds one of them.',
              clientId,
              file,
            },
          ],
        };
      } catch {
        // fall through to the diagnostics below, reported from the strict error
      }
    }
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
  let note: string | undefined;
  if (opts.projectScope) {
    const scope = extractClaudeProjectServers(data);
    if (scope.servers.length > 0) {
      servers.push(...scope.servers);
      note = `${scope.servers.length} project-scoped server(s) from ${scope.projects} project(s)`;
    }
  }
  return { ok: true, servers, diagnostics: [], note };
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
//
// dsh MCP servers are patch entries shaped like:
//   - id: mcp-github
//     name: '@deepseek-ai/dsh-mcp-client'
//     config:
//       serverName: github
//       transport: stdio            # stdio | streamable-http
//       command: npx
//       args: ['-y', '@modelcontextprotocol/server-github']   # inline or block sequence
//       env:
//         GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN          # block map; !!js expressions kept as text
// (Source: @deepseek-ai/dsh-mcp-client README, v0.1.5-rc.2.)

/** Strip a YAML cast prefix like `!!js ` from a scalar. */
function stripCast(v: string): string {
  return v.replace(/^!!js\s+/, '').trim();
}

/** Remove a trailing ` # comment` from a plain scalar (leaves # inside quotes alone). */
function stripInlineComment(t: string): string {
  let inS = false;
  let q = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inS) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === q) inS = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inS = true;
      q = c;
      continue;
    }
    if (c === '#' && i > 0 && /\s/.test(t[i - 1])) return t.slice(0, i).trimEnd();
  }
  return t;
}

/** Parse a YAML/JSON-ish scalar to a plain string. */
function yamlScalar(raw: string): string {
  return unquote(stripCast(stripInlineComment(raw).trim())).trim();
}

/** Split a flow collection body on top-level commas (ignores commas inside quotes). */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inS = false;
  let q = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inS) {
      cur += c;
      if (c === '\\') {
        cur += body[i + 1] ?? '';
        i++;
        continue;
      }
      if (c === q) inS = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inS = true;
      q = c;
      cur += c;
      continue;
    }
    if (c === ',') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '' || parts.length > 0) parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** Parse an inline array body (without brackets) into strings. Unquoted tokens are kept as-is. */
function parseFlowArray(body: string): string[] {
  return splitFlow(body).map((p) => yamlScalar(p));
}

/** Parse an inline map body (without braces) into string values. */
function parseFlowMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of splitFlow(body)) {
    const m = part.match(/^("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (m) out[unquote(m[1])] = yamlScalar(m[2]);
  }
  return out;
}

function chunkIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

export function parseYamlLight(text: string, file: string, clientId: string): ParseOutcome {
  const servers: ServerEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  const normalized = text.replace(/\r\n/g, '\n');
  // Each patch entry starts at a `- id:` list item (any indent, e.g. nested under `insert:`).
  const chunks = normalized.split(/\n(?=\s*-\s+id:)/);
  for (const chunk of chunks) {
    if (!chunk.includes('dsh-mcp-client')) continue;
    const idMatch = chunk.match(/-\s*id:\s*(\S+)/);
    const entry: ServerEntry = { name: 'dsh-mcp-client' };
    const lines = chunk.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const keyMatch = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!keyMatch) continue;
      const [, indent, key, restRaw] = keyMatch;
      const rest = restRaw.trim();

      if (key === 'serverName' && rest) {
        entry.name = yamlScalar(rest) || entry.name;
      } else if (key === 'transport' && rest) {
        entry.transport = yamlScalar(rest);
      } else if (key === 'command' && rest) {
        entry.command = yamlScalar(rest);
      } else if (key === 'url' && rest) {
        entry.url = yamlScalar(rest);
      } else if (key === 'cwd' && rest) {
        entry.cwd = yamlScalar(rest);
      } else if (key === 'args') {
        if (rest && rest.startsWith('[')) {
          entry.args = parseFlowArray(rest.replace(/^\[/, '').replace(/\]\s*$/, ''));
        } else {
          const items: string[] = [];
          const keyIndent = indent.length;
          for (let j = i + 1; j < lines.length; j++) {
            const l = lines[j];
            if (l.trim() === '') continue;
            if (chunkIndent(l) <= keyIndent) break;
            const m = l.match(/^\s*-\s+(.*)$/);
            if (!m) break;
            items.push(yamlScalar(m[1]));
          }
          if (items.length > 0) entry.args = items;
        }
      } else if (key === 'env') {
        const env: Record<string, string> = {};
        if (rest.startsWith('{')) {
          Object.assign(env, parseFlowMap(rest.replace(/^\{/, '').replace(/\}\s*$/, '')));
        } else {
          const keyIndent = indent.length;
          for (let j = i + 1; j < lines.length; j++) {
            const l = lines[j];
            if (l.trim() === '') continue;
            if (chunkIndent(l) <= keyIndent) break;
            const m = l.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
            if (!m) continue;
            env[m[1]] = yamlScalar(m[2]);
          }
        }
        if (Object.keys(env).length > 0) entry.env = env;
      }
    }

    const idTail = idMatch ? idMatch[1] : undefined;
    if (entry.name === 'dsh-mcp-client' && idTail) entry.name = `dsh:${idTail}`;
    const serverNameMatch = chunk.match(/^\s*serverName:\s*(\S.*)$/m);
    if (!serverNameMatch) {
      diagnostics.push({
        checkId: 'dsh.serverName-missing',
        severity: 'error',
        title: 'dsh MCP entry has no serverName — the entry will fail to load',
        detail: idTail ? `entry id: ${idTail}` : undefined,
        clientId,
        file,
        hint: "Add `serverName: <short-name>` (required, [A-Za-z0-9_-]{1,32}) — it namespaces the server's tools as mcp__<serverName>__<tool>.",
      });
    } else if (!/^[A-Za-z0-9_-]{1,32}$/.test(entry.name)) {
      diagnostics.push({
        checkId: 'dsh.serverName-invalid',
        severity: 'warning',
        title: `serverName "${entry.name}" does not match [A-Za-z0-9_-]{1,32}`,
        clientId,
        file,
        serverName: entry.name,
        hint: 'Use letters, digits, _ and - only (max 32 chars); names become model-facing tool prefixes.',
      });
    }
    servers.push(entry);
  }
  return { ok: true, servers, diagnostics, caveat: 'yaml-light' };
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
  // Claude Code's ~/.claude.json also carries project-scoped server bags (projects.*.mcpServers).
  const projectScope = f.clientId === 'claude-code' && f.scope === 'global';
  const r =
    f.format === 'json' ? parseJsonConfig(text, f.file, f.clientId, { json5: f.json5, json5Fallback: f.json5Fallback, projectScope })
    : f.format === 'toml' ? parseTomlConfig(text, f.file, f.clientId)
    : parseYamlLight(text, f.file, f.clientId);
  return {
    clientId: f.clientId,
    file: f.file,
    format: f.format,
    ok: r.ok,
    caveat: r.caveat,
    note: r.note,
    servers: r.servers,
    diagnostics: r.diagnostics,
  };
}
