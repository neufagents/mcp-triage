import test from 'node:test';
import assert from 'node:assert/strict';
import { extractServersFromJson, findTrailingComma, parseJsonConfig, parseTomlConfig, parseYamlLight } from '../src/parse.ts';

test('json: valid config extracts servers (mcpServers)', () => {
  const text = JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' } } } }, null, 2);
  const r = parseJsonConfig(text, 'x.json', 'cursor');
  assert.equal(r.ok, true);
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].command, 'npx');
  assert.deepEqual(r.servers[0].env, { A: '1' });
});

test('json: trailing comma is diagnosed', () => {
  const text = '{\n  "mcpServers": {\n    "a": { "command": "npx" },\n  }\n}';
  const r = parseJsonConfig(text, 'x.json', 'cursor');
  assert.equal(r.ok, false);
  const d = r.diagnostics[0];
  assert.equal(d.checkId, 'config.syntax');
  assert.match(d.title, /Trailing comma/);
});

test('json: vs code "servers" shape and openclaw mcp.servers shape', () => {
  const a = extractServersFromJson({ servers: { s1: { command: 'node' } } });
  assert.equal(a.length, 1);
  const b = extractServersFromJson({ mcp: { servers: { s2: { url: 'https://x' } } } });
  assert.equal(b.length, 1);
});

test('toml: codex mcp_servers tables', () => {
  const text = [
    'model = "gpt-5"',
    '[mcp_servers.node_repl]',
    'command = "node"',
    'args = ["--experimental-repl", "repl.js"]',
    '[mcp_servers.node_repl.env]',
    'FOO = "bar"',
  ].join('\n');
  const r = parseTomlConfig(text, 'config.toml', 'codex');
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'node_repl');
  assert.equal(r.servers[0].command, 'node');
  assert.deepEqual(r.servers[0].args, ['--experimental-repl', 'repl.js']);
  assert.deepEqual(r.servers[0].env, { FOO: 'bar' });
});

test('yaml-light: dsh mcp-client plugin entry', () => {
  const text = [
    '- id: mcp-github',
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    '    serverName: github',
    '    transport: stdio',
    '    command: npx',
    '    args:',
    "      - '-y'",
    "      - '@modelcontextprotocol/server-github'",
  ].join('\n');
  const r = parseYamlLight(text, 'cordis.patch.yml', 'dsh');
  assert.equal(r.servers.length, 1);
  assert.equal(r.servers[0].name, 'github');
  assert.equal(r.servers[0].command, 'npx');
});
