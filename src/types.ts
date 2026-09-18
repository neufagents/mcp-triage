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
  /** Explicitly disabled entries (OpenClaw `enabled: false`) — kept but not connected; runtime checks are skipped. */
  enabled?: boolean;
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
  /** File format is JSON5 (comments + trailing commas are legal) — parse leniently. */
  json5?: boolean;
  /** Env var that overrides the config path (e.g. OPENCLAW_CONFIG_PATH); scanned in addition when set. */
  envOverride?: string;
  /** True when the path/format is not yet verified against official docs (pre-release). */
  verify?: boolean;
}

export interface DiscoveredFile {
  clientId: string;
  file: string;
  format: Format;
  scope: 'global' | 'project';
  /** Inherited from the client spec (JSON5-tolerant parsing). */
  json5?: boolean;
  /** Unknown client (e.g. explicit --file): try a JSON5 fallback and report it as info when it applies. */
  json5Fallback?: boolean;
}

export interface ScanResult {
  files: DiscoveredFile[];
  parsed: ParsedConfig[];
  diagnostics: Diagnostic[];
}

// ---------- Fix engine (v0.1: mechanical JSON repairs) ----------

export type FixStatus = 'fixed' | 'would-fix' | 'not-fixable' | 'skipped';

export interface FixOutcome {
  file: string;
  clientId: string;
  status: FixStatus;
  /** Human-readable list of repairs applied (or that would be applied). */
  changes: string[];
  /** Path of the backup written before the fix (absent for dry runs and non-writes). */
  backupPath?: string;
  /** True when an earlier backup existed and was kept (the file had been backed up before). */
  backupKept?: boolean;
  /** Why nothing was written (for not-fixable / skipped). */
  reason?: string;
}
