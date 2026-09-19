// Library entry — programmatic use:
//   import { discoverFiles, parseConfigFile, runChecks, applyFixes } from 'mcp-triage';
// The CLI (dist/cli.js, `bin`) is the primary interface; this entry exposes the same
// pipeline pieces for embedding. Zero runtime dependencies.

export { VERSION } from './version.ts';
export { CLIENTS, clientPathsForPlatform, defaultPathContext, expandPlaceholders } from './clients.ts';
export type { PathContext } from './clients.ts';
export { discoverFiles, expandGlob } from './discover.ts';
export {
  parseConfigFile,
  parseJsonConfig,
  parseTomlConfig,
  parseYamlLight,
  normalizeJson5,
  extractServersFromJson,
  extractClaudeProjectServers,
  findTrailingComma,
  stripTrailingCommas,
  readFileSafe,
} from './parse.ts';
export type { ClaudeProjectScope } from './parse.ts';
export { runChecks, checkCrossClientDrift, resolveCommandOnPath, findEnvRefs, DEFAULT_CHECK_CONTEXT } from './checks.ts';
export type { CheckContext } from './checks.ts';
export { runServer, handleMessage, TOOLS, runScan, runFix, collectDiagnostics, SERVER_NAME } from './serve.ts';
export type { ToolDef, RpcRequest, RpcResponse, ScanOutcome } from './serve.ts';
export { applyFixes, repairJsonText, stripJsonComments } from './fix.ts';
export type { FixOptions, RepairResult } from './fix.ts';
export { renderHuman, renderJson } from './report.ts';
export type { ReportInput } from './report.ts';
export type {
  ClientSpec,
  Diagnostic,
  DiscoveredFile,
  FixOutcome,
  FixStatus,
  Format,
  ParsedConfig,
  ScanResult,
  ServerEntry,
  Severity,
} from './types.ts';
