// Client registry: 8 clients x config locations.
// Paths verified against this machine where available (see research/2026-09-19-mcp-建前复核与命名决策.md §3).
// `verify: true` = path/format still needs an official-docs check before release.

import os from 'node:os';
import path from 'node:path';
import type { ClientSpec } from './types.ts';

export const CLIENTS: ClientSpec[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    format: 'json',
    paths: {
      win32: ['<appdata>/Claude/claude_desktop_config.json'],
      darwin: ['<home>/Library/Application Support/Claude/claude_desktop_config.json'],
      linux: ['<config>/Claude/claude_desktop_config.json'],
    },
    serversHint: 'mcpServers',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    format: 'json',
    paths: {
      any: ['<home>/.claude.json'],
    },
    projectPaths: ['.mcp.json'],
    serversHint: 'mcpServers (global in ~/.claude.json; project in .mcp.json)',
  },
  {
    id: 'codex',
    name: 'Codex',
    format: 'toml',
    paths: {
      any: ['<home>/.codex/config.toml'],
    },
    serversHint: '[mcp_servers.<name>] tables',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    format: 'json',
    paths: {
      any: ['<home>/.cursor/mcp.json'],
    },
    projectPaths: ['.cursor/mcp.json'],
    serversHint: 'mcpServers',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    format: 'json',
    paths: {
      win32: ['<appdata>/Code/User/mcp.json'],
      darwin: ['<home>/Library/Application Support/Code/User/mcp.json'],
      linux: ['<config>/Code/User/mcp.json'],
    },
    projectPaths: ['.vscode/mcp.json'],
    serversHint: 'servers',
    verify: true,
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    format: 'json',
    paths: {
      any: ['<home>/.codeium/windsurf/mcp_config.json'],
    },
    serversHint: 'mcpServers',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    format: 'json',
    paths: {
      any: ['<home>/.openclaw/openclaw.json', '<config>/openclaw/config.json'],
    },
    serversHint: 'mcpServers | mcp.servers',
    verify: true,
  },
  {
    id: 'dsh',
    name: 'dsh (DeepSeek Harness)',
    format: 'yaml',
    paths: {
      any: ['<home>/.dsh/profiles/*/cordis.patch.yml', '<home>/.dsh/profiles/*/cordis.yml'],
    },
    serversHint: '@deepseek-ai/dsh-mcp-client plugin entries',
    verify: true,
  },
];

export interface PathContext {
  platform: NodeJS.Platform;
  home: string;
  appdata: string;
  configDir: string;
}

export function defaultPathContext(): PathContext {
  const home = os.homedir();
  return {
    platform: process.platform,
    home,
    appdata: process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
    configDir: path.join(home, '.config'),
  };
}

export function expandPlaceholders(p: string, ctx: PathContext): string {
  return p.replace(/<home>/g, ctx.home).replace(/<appdata>/g, ctx.appdata).replace(/<config>/g, ctx.configDir);
}

export function clientPathsForPlatform(spec: ClientSpec, ctx: PathContext): string[] {
  const plat = spec.paths[ctx.platform as 'win32' | 'darwin' | 'linux'] ?? [];
  const any = spec.paths.any ?? [];
  return [...plat, ...any].map((p) => expandPlaceholders(p, ctx));
}
