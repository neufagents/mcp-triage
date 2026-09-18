// Checks engine: takes parsed configs, returns diagnostics.
// v0.1 built-ins: command presence, command resolvability on PATH, ${VAR} env refs, relative-path args, insecure http url.

import fs from 'node:fs';
import path from 'node:path';
import type { Diagnostic, ParsedConfig, ServerEntry } from './types.ts';

export interface CheckContext {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export const DEFAULT_CHECK_CONTEXT: CheckContext = { env: process.env, platform: process.platform };

function isFileExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform !== 'win32') {
      // any execute bit
      return (st.mode & 0o111) !== 0;
    }
    return true;
  } catch {
    return false;
  }
}

/** Resolve a bare command name on PATH (or verify an absolute one). Returns resolved path or null. */
export function resolveCommandOnPath(cmd: string, ctx: CheckContext): string | null {
  const hasSep = cmd.includes('/') || cmd.includes('\\');
  if (hasSep) return isFileExecutable(cmd) ? cmd : null;
  const pathVar = ctx.env.PATH ?? ctx.env.Path ?? '';
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const exts =
    ctx.platform === 'win32'
      ? (ctx.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, cmd + ext);
      if (isFileExecutable(cand)) return cand;
    }
    // Windows: command may already carry its extension
    const direct = path.join(dir, cmd);
    if (isFileExecutable(direct)) return direct;
  }
  return null;
}

const ENV_REF_RE = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function findEnvRefs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(ENV_REF_RE)) out.push(m[1]);
  return out;
}

function stringy(s: ServerEntry): string[] {
  const parts: string[] = [];
  if (s.command) parts.push(s.command);
  if (s.args) parts.push(...s.args);
  if (s.url) parts.push(s.url);
  if (s.env) for (const v of Object.values(s.env)) if (v) parts.push(v);
  if (s.cwd) parts.push(s.cwd);
  return parts;
}

function checkServer(clientId: string, file: string, s: ServerEntry, ctx: CheckContext): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const base = { clientId, file, serverName: s.name };

  if (!s.command && !s.url) {
    diags.push({
      checkId: 'server.command-missing',
      severity: 'error',
      title: 'Server has neither "command" nor "url" — it cannot start',
      ...base,
      hint: 'Add a command (stdio) or a url (remote). This entry is inert as written.',
    });
    return diags;
  }

  if (s.command) {
    const resolved = resolveCommandOnPath(s.command, ctx);
    if (!resolved) {
      diags.push({
        checkId: 'server.command-unresolvable',
        severity: 'error',
        title: `command "${s.command}" not found on PATH`,
        ...base,
        hint:
          'This is the #1 cause of "server silently missing" bugs. Common causes: nvm-managed node (the client does not load your shell profile), missing pnpm/uv, or a typo. Use an absolute path or install the runtime the client can see.',
      });
    }
  }

  if (s.url && /^http:\/\//i.test(s.url)) {
    diags.push({
      checkId: 'server.url-insecure',
      severity: 'warning',
      title: 'Remote server uses plain http://',
      ...base,
      detail: s.url,
      hint: 'Prefer https:// unless this is a deliberate localhost setup.',
    });
  }

  if (s.args) {
    for (const a of s.args) {
      if (a.startsWith('./') || a.startsWith('../')) {
        diags.push({
          checkId: 'server.relative-path-arg',
          severity: 'warning',
          title: `Relative path argument "${a}" may resolve from the wrong directory`,
          ...base,
          hint: 'Clients spawn servers from their own working directory. Use an absolute path to make this stable.',
        });
        break;
      }
    }
  }

  const missing = new Set<string>();
  for (const part of stringy(s)) {
    for (const ref of findEnvRefs(part)) {
      if (!ctx.env[ref]) missing.add(ref);
    }
  }
  if (missing.size > 0) {
    diags.push({
      checkId: 'server.env-ref-missing',
      severity: 'warning',
      title: `Referenced env var${missing.size > 1 ? 's' : ''} not set: ${[...missing].join(', ')}`,
      ...base,
      hint: 'Set it in your shell AND make sure the client process can see it (GUI apps often do not inherit shell env).',
    });
  }

  return diags;
}

export function runChecks(parsed: ParsedConfig[], ctx: CheckContext = DEFAULT_CHECK_CONTEXT): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const p of parsed) {
    for (const s of p.servers) out.push(...checkServer(p.clientId, p.file, s, ctx));
  }
  return out;
}

/** Cross-file drift: same server name present in multiple clients but with different launch shape. */
export function checkCrossClientDrift(parsed: ParsedConfig[]): Diagnostic[] {
  const byName = new Map<string, { file: string; clientId: string; shape: string }[]>();
  for (const p of parsed) {
    for (const s of p.servers) {
      const shape = JSON.stringify([s.command ?? s.url ?? '', s.args ?? []]);
      const list = byName.get(s.name) ?? [];
      list.push({ file: p.file, clientId: p.clientId, shape });
      byName.set(s.name, list);
    }
  }
  const out: Diagnostic[] = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const shapes = new Set(list.map((l) => l.shape));
    if (shapes.size > 1) {
      out.push({
        checkId: 'config.cross-client-drift',
        severity: 'info',
        title: `Server "${name}" is configured differently across ${list.length} clients`,
        detail: list.map((l) => `${l.clientId} → ${l.file}`).join('\n'),
        hint: 'Drift is not always wrong — but when one client works and another does not, this is where to look.',
        clientId: list[0].clientId,
        file: list[0].file,
        serverName: name,
      });
    }
  }
  return out;
}
