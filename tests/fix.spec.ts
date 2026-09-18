import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyFixes, repairJsonText, stripJsonComments } from '../src/fix.ts';
import type { DiscoveredFile, ParsedConfig } from '../src/types.ts';

const tmpfile = (name: string, content: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-fix-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  return f;
};

const discovered = (file: string): DiscoveredFile => ({ clientId: 'cursor', file, format: 'json', scope: 'global' });
const parsedBroken = (file: string): ParsedConfig => ({
  clientId: 'cursor',
  file,
  format: 'json',
  ok: false,
  servers: [],
  diagnostics: [],
});
const parsedOk = (file: string): ParsedConfig => ({ ...parsedBroken(file), ok: true });

// ---------- repairJsonText ----------

test('fix: trailing comma is removed and the result parses', () => {
  const text = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
  const r = repairJsonText(text);
  assert.doesNotThrow(() => JSON.parse(r.out));
  assert.deepEqual(r.changes, ['removed 1 trailing comma']);
});

test('fix: line and block comments are stripped', () => {
  const text = '{\n  // my server\n  /* setup */\n  "mcpServers": {}\n}';
  const r = repairJsonText(text);
  assert.doesNotThrow(() => JSON.parse(r.out));
  assert.deepEqual(r.changes, ['stripped 2 comments']);
});

test('fix: comments inside strings are not touched', () => {
  const text = '{\n  "mcpServers": {\n    "a": { "command": "npx", "args": ["http://x//y", "a,}b"] }\n  }\n}';
  const r = repairJsonText(text);
  assert.equal(r.out, text);
  assert.deepEqual(r.changes, []);
});

test('fix: trailing comma inside a string is not touched', () => {
  const text = '{\n  "note": "ends with ,}",\n  "mcpServers": {}\n}';
  const r = repairJsonText(text);
  assert.equal(r.out, text);
  assert.deepEqual(r.changes, []);
});

test('fix: CRLF line endings survive comment stripping', () => {
  const text = '{\r\n  // c\r\n  "mcpServers": {}\r\n}';
  const r = repairJsonText(text);
  assert.equal(r.out, '{\r\n  \r\n  "mcpServers": {}\r\n}');
  assert.doesNotThrow(() => JSON.parse(r.out));
});

test('fix: a clean file yields no changes', () => {
  const text = '{\n  "mcpServers": {}\n}\n';
  const r = repairJsonText(text);
  assert.equal(r.out, text);
  assert.deepEqual(r.changes, []);
});

test('stripJsonComments: counts each comment token', () => {
  assert.equal(stripJsonComments('{} // one\n/* two */\n{}').removed, 2);
  assert.equal(stripJsonComments('{"a": "// not a comment"}').removed, 0);
});

// ---------- applyFixes ----------

test('applyFixes: writes the fixed file and a backup of the original', () => {
  const original = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
  const f = tmpfile('mcp.json', original);
  const out = applyFixes([discovered(f)], [parsedBroken(f)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'fixed');
  assert.deepEqual(out[0].changes, ['removed 1 trailing comma']);
  assert.ok(out[0].backupPath && fs.existsSync(out[0].backupPath));
  assert.equal(fs.readFileSync(out[0].backupPath!, 'utf8'), original);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, 'utf8')));
});

test('applyFixes: dry run reports but writes nothing', () => {
  const original = '{\n  "mcpServers": {},\n}';
  const f = tmpfile('mcp.json', original);
  const out = applyFixes([discovered(f)], [parsedBroken(f)], { dryRun: true });
  assert.equal(out[0].status, 'would-fix');
  assert.equal(fs.readFileSync(f, 'utf8'), original);
  assert.ok(!fs.existsSync(f + '.mcp-triage.bak'));
});

test('applyFixes: a second run keeps the pristine existing backup', () => {
  const original = '{\n  "mcpServers": {},\n}';
  const f = tmpfile('mcp.json', original);
  const first = applyFixes([discovered(f)], [parsedBroken(f)]);
  assert.equal(first[0].status, 'fixed');
  // Re-break the file, run again: the first backup must survive untouched.
  fs.writeFileSync(f, original + '\n// dangling comment');
  const second = applyFixes([discovered(f)], [parsedBroken(f)]);
  assert.equal(second[0].status, 'fixed');
  assert.equal(second[0].backupKept, true);
  assert.equal(fs.readFileSync(first[0].backupPath!, 'utf8'), original);
});

test('applyFixes: unfixable file (other syntax problems) is left alone', () => {
  const original = '{\n  "a": 1,\n  /* note */ "b" 2,\n}';
  const f = tmpfile('mcp.json', original);
  const out = applyFixes([discovered(f)], [parsedBroken(f)]);
  assert.equal(out[0].status, 'not-fixable');
  assert.ok(out[0].reason && /still does not parse/.test(out[0].reason));
  assert.equal(fs.readFileSync(f, 'utf8'), original);
  assert.ok(!fs.existsSync(f + '.mcp-triage.bak'));
});

test('applyFixes: no repair applies to a plain non-JSON file', () => {
  const original = '{"a": 1 "b": 2}';
  const f = tmpfile('mcp.json', original);
  const out = applyFixes([discovered(f)], [parsedBroken(f)]);
  assert.equal(out[0].status, 'not-fixable');
  assert.ok(out[0].reason && /no mechanical repair/.test(out[0].reason));
});

test('applyFixes: unreadable file is skipped', () => {
  const f = path.join(os.tmpdir(), 'triage-fix-missing-' + Date.now(), 'nope.json');
  const out = applyFixes([discovered(f)], [parsedBroken(f)]);
  assert.equal(out[0].status, 'skipped');
  assert.ok(out[0].reason && /could not be read/.test(out[0].reason));
});

test('applyFixes: healthy files are not candidates', () => {
  const f = tmpfile('mcp.json', '{\n  "mcpServers": {}\n}');
  const out = applyFixes([discovered(f)], [parsedOk(f)]);
  assert.equal(out.length, 0);
  assert.ok(!fs.existsSync(f + '.mcp-triage.bak'));
});
