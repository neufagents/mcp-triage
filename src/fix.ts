// Fix engine: mechanical, verifiable repairs for JSON config files that fail to parse.
//
// v0.1 scope is deliberately small — pure-deletion repairs only, applied on a copy:
//   1. strip // and /* */ comments        (string-aware)
//   2. drop trailing commas before } or ] (string-aware)
// The repaired copy must pass JSON.parse or nothing is written. Before the first write a
// `.mcp-triage.bak` backup of the original file is created (an existing backup is kept, not
// overwritten, so the pristine pre-fix version survives repeated runs).

import fs from 'node:fs';
import { readFileSafe, stripTrailingCommas } from './parse.ts';
import type { DiscoveredFile, FixOutcome, ParsedConfig } from './types.ts';

export interface FixOptions {
  /** Compute what a fix would do, write nothing. */
  dryRun?: boolean;
}

/**
 * Strip `// line` comments and `/* block *\/` comments, ignoring string context
 * (both quote styles are tracked, escapes honored). Line endings are preserved
 * (a `// ...` on a CRLF line leaves the CRLF in place).
 */
export function stripJsonComments(text: string): { out: string; removed: number } {
  let out = '';
  let inString = false;
  let quote = '"';
  let removed = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i++;
        continue;
      }
      if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      removed++;
      while (i < text.length && text[i] !== '\n') i++;
      if (i >= text.length) break; // comment runs to EOF — drop the tail
      out += text[i - 1] === '\r' ? '\r\n' : '\n';
      continue; // the for-loop advance moves past the '\n'
    }
    if (c === '/' && text[i + 1] === '*') {
      removed++;
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // position on '/': the for-loop advance moves past it
      continue;
    }
    out += c;
  }
  return { out, removed };
}

export interface RepairResult {
  /** The repaired candidate text (equal to the input when no repair applies). */
  out: string;
  /** Human-readable descriptors, e.g. ['stripped 1 comment', 'removed 2 trailing commas']. */
  changes: string[];
}

/** Apply the mechanical repair passes to a copy of the text. Never touches the disk. */
export function repairJsonText(text: string): RepairResult {
  const changes: string[] = [];
  const noComments = stripJsonComments(text);
  if (noComments.removed > 0) {
    changes.push(`stripped ${noComments.removed} comment${noComments.removed === 1 ? '' : 's'}`);
  }
  const noTrailing = stripTrailingCommas(noComments.out);
  const dropped = noComments.out.length - noTrailing.length; // the pass only deletes ',' chars
  if (dropped > 0) {
    changes.push(`removed ${dropped} trailing comma${dropped === 1 ? '' : 's'}`);
  }
  return { out: noTrailing, changes };
}

/** Files that currently fail to parse get one repair attempt; everything else is untouched. */
export function applyFixes(files: DiscoveredFile[], parsed: ParsedConfig[], opts: FixOptions = {}): FixOutcome[] {
  const outcomes: FixOutcome[] = [];
  for (let i = 0; i < files.length; i++) {
    const p = parsed[i];
    if (!p || p.ok) continue; // fix candidates are exactly the files that fail to parse
    outcomes.push(fixOne(files[i], opts));
  }
  return outcomes;
}

function fixOne(f: DiscoveredFile, opts: FixOptions): FixOutcome {
  const base = { file: f.file, clientId: f.clientId, changes: [] as string[] };
  const text = readFileSafe(f.file);
  if (text === null) {
    return { ...base, status: 'skipped', reason: 'file could not be read' };
  }

  const { out, changes } = repairJsonText(text);
  if (changes.length === 0) {
    return {
      ...base,
      status: 'not-fixable',
      reason: 'no mechanical repair applies (not a comments / trailing-commas problem)',
    };
  }

  let parseOk = false;
  try {
    JSON.parse(out.replace(/^\uFEFF/, '')); // same BOM handling as the parser
    parseOk = true;
  } catch {
    // leave parseOk false
  }
  if (!parseOk) {
    return {
      ...base,
      status: 'not-fixable',
      changes,
      reason: 'the repaired copy still does not parse as JSON — the file has other syntax problems; nothing was written',
    };
  }

  if (opts.dryRun) {
    return { ...base, status: 'would-fix', changes };
  }

  const backupPath = f.file + '.mcp-triage.bak';
  const backupExisted = fs.existsSync(backupPath);
  try {
    if (!backupExisted) fs.writeFileSync(backupPath, text, 'utf8');
    fs.writeFileSync(f.file, out, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, status: 'skipped', changes, reason: `write failed: ${msg}` };
  }
  return { ...base, status: 'fixed', changes, backupPath, backupKept: backupExisted || undefined };
}
