// Discovery: expand client paths (placeholders + one '*' segment), keep files that exist.

import fs from 'node:fs';
import path from 'node:path';
import { CLIENTS, clientPathsForPlatform, defaultPathContext, type PathContext } from './clients.ts';
import type { DiscoveredFile } from './types.ts';

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Expand a pattern containing at most one '*' path segment. Returns [] when nothing exists. */
export function expandGlob(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern];
  const norm = pattern.split('/');
  const starIdx = norm.findIndex((seg) => seg.includes('*'));
  if (starIdx === -1) return [pattern];
  const seg = norm[starIdx];
  if (seg !== '*') return [pattern]; // only plain single-star segments supported in v0.1
  const parent = norm.slice(0, starIdx).join('/');
  const rest = norm.slice(starIdx + 1);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const candidate = [parent, e, ...rest].join('/');
    if (isFile(candidate)) out.push(candidate);
  }
  return out;
}

export function discoverFiles(cwd: string, ctx: PathContext = defaultPathContext()): DiscoveredFile[] {
  const seen = new Set<string>();
  const out: DiscoveredFile[] = [];
  const push = (f: DiscoveredFile) => {
    const key = f.file.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  for (const spec of CLIENTS) {
    for (const p of clientPathsForPlatform(spec, ctx)) {
      for (const f of expandGlob(p)) {
        if (isFile(f)) push({ clientId: spec.id, file: f, format: spec.format, scope: 'global', json5: spec.json5 });
      }
    }
    if (spec.envOverride && ctx.env?.[spec.envOverride]) {
      const f = path.resolve(ctx.env[spec.envOverride] as string);
      if (isFile(f)) push({ clientId: spec.id, file: f, format: spec.format, scope: 'global', json5: spec.json5 });
    }
    for (const rel of spec.projectPaths ?? []) {
      const f = path.join(cwd, rel);
      if (isFile(f)) push({ clientId: spec.id, file: f, format: spec.format, scope: 'project', json5: spec.json5 });
    }
  }
  return out;
}
