// Core types for mcp-triage v0.1

export type Severity = 'error' | 'warning' | 'info';
export type Format = 'json' | 'toml' | 'yaml';

export interface Diagnostic {
  /** Stable id, e.g. 'config.syntax', 'server.command-resolvable' */
  checkId: string;
  severity: Severity;
  /** One-line, plain English */
  title: string;
  detail?: string;
  hint?: string;
  clientId?: string;
  file?: string;
  serverName?: string;
  /** Whether `--fix` can address this in a future/current version */
  fixable?: boolean;
}

export interface ServerEntry {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  url?: string;
  transport?: string;
  cwd?: string;
}

export interface ParsedConfig {
  clientId: string;
  file: string;
  format: Format;
  ok: boolean;
  /** Set when parsing is intentionally partial, e.g. 'toml-minimal', 'yaml-light' */
  caveat?: string;
  servers: ServerEntry[];
  diagnostics: Diagnostic[];
}

export interface ClientSpec {
  id: string;
  name: string;
  format: Format;
  /**
   * Config paths per platform. Placeholders: <home> <appdata> <config>.
   * A single '*' segment is allowed for profile-style dirs (e.g. dsh profiles).
   */
  paths: Partial<Record<'win32' | 'darwin' | 'linux' | 'any', string[]>>;
  /** Project-level (relative to cwd) config paths */
  projectPaths?: string[];
  /** Where server entries live in the file (informational) */
  serversHint: string;
  /** True when the path/format is not yet verified against official docs (pre-release) */
  verify?: boolean;
}

export interface DiscoveredFile {
  clientId: string;
  file: string;
  format: Format;
  scope: 'global' | 'project';
}

export interface ScanResult {
  files: DiscoveredFile[];
  parsed: ParsedConfig[];
  diagnostics: Diagnostic[];
}
