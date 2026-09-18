// Client registry: 8 clients x config locations.
// Path verification round (2026-09-19, night cycle): all 8 verified against official docs
// and/or this machine. Sources per entry. `verify: true` marks entries NOT yet verified.
//
// Sources:
// - VS Code: code.visualstudio.com/docs/agents/reference/mcp-configuration (mcp.json; user profile via
//   "MCP: Open User Configuration"; workspace .vscode/mcp.json; servers key). Remote/WSL path
//   ~/.vscode-server/data/User/mcp.json confirmed via StackOverflow 79706687 + microsoft/vscode#256546.
// - OpenClaw: docs.openclaw.ai/gateway/configuration (JSON5 config at ~/.openclaw/openclaw.json,
//   path overridable via OPENCLAW_CONFIG_PATH) + docs.openclaw.ai/tools/mcp (mcp.servers map).
// - dsh: machine-verified 2026-09-19 (~/.dsh/profiles/{headless,web}/cordis{,.patch}.yml exist locally)
//   + @deepseek-ai/dsh-mcp-client@0.1.5-rc.2 README (patch entry: name + config.{serverName,transport,...}).

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
      // Remote/WSL sessions keep the user config on the server side (~/.vscode-server/data/User/).
      darwin: ['<home>/Library/Application Support/Code/User/mcp.json', '<home>/.vscode-server/data/User/mcp.json'],
      linux: ['<config>/Code/User/mcp.json', '<home>/.vscode-server/data/User/mcp.json'],
    },
    projectPaths: ['.vscode/mcp.json'],
    serversHint: 'servers',
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
    json5: true,
    envOverride: 'OPENCLAW_CONFIG_PATH',
    paths: {
      any: ['<home>/.openclaw/openclaw.json', '<config>/openclaw/config.json'],
    },
    serversHint: 'mcp.servers (older guides may show mcpServers)',
  },
  {
    id: 'dsh',
    name: 'dsh (DeepSeek Harness)',
    format: 'yaml',
    paths: {
      any: ['<home>/.dsh/profiles/*/cordis.patch.yml', '<home>/.dsh/profiles/*/cordis.yml'],
    },
    serversHint: '@deepseek-ai/dsh-mcp-client patch entries (config.serverName/transport/command/args/env)',
  },
];

export interface PathContext {
  platform: NodeJS.Platform;
  home: string;
  appdata: string;
  configDir: string;
  /** Process env (used for path overrides like OPENCLAW_CONFIG_PATH). Optional for tests. */
  env?: NodeJS.ProcessEnv;
}

export function defaultPathContext(): PathContext {
  const home = os.homedir();
  return {
    platform: process.platform,
    home,
    appdata: process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
    configDir: path.join(home, '.config'),
    env: process.env,
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
