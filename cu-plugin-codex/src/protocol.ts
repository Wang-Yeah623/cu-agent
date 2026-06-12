/**
 * Cu Plugin — 通信协议（从主项目 src/core/protocol.ts 精简而来，不含 zod）。
 * 与主项目保持一致；若主项目协议变更，请同步此文件。
 */

export enum PluginMessageType {
  REQUEST = "request",
  RESPONSE = "response",
  EVENT = "event",
  PING = "ping",
  PONG = "pong",
}

export enum PluginMethod {
  FILE_CREATE = "file.create",
  FILE_READ = "file.read",
  FILE_EDIT = "file.edit",
  FILE_DELETE = "file.delete",
  FILE_LIST = "file.list",
  TERMINAL_EXEC = "terminal.exec",
  TERMINAL_EXEC_STREAM = "terminal.execStream",
  TERMINAL_STOP = "terminal.stop",
  IDE_OPEN_FILE = "ide.openFile",
  IDE_GET_OPEN_FILES = "ide.getOpenFiles",
  IDE_GET_SELECTION = "ide.getSelection",
  IDE_SET_SELECTION = "ide.setSelection",
  IDE_GET_DIAGNOSTICS = "ide.getDiagnostics",
  PLUGIN_STATUS = "plugin.status",
  PLUGIN_PING = "plugin.ping",
}

export enum PluginEvent {
  FILE_CHANGED = "file.changed",
  DIAGNOSTICS_UPDATED = "diagnostics.updated",
  TERMINAL_OUTPUT = "terminal.output",
  PLUGIN_ERROR = "plugin.error",
  PLUGIN_READY = "plugin.ready",
  PLUGIN_CLOSING = "plugin.closing",
}

export interface PluginError {
  code: string;
  message: string;
  stack?: string;
}

export interface PluginMessage {
  type: PluginMessageType;
  id: string;
  method?: PluginMethod;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: PluginError;
  event?: string;
  eventData?: unknown;
  timestamp: number;
}

export interface PluginResponse {
  type: PluginMessageType.RESPONSE;
  id: string;
  method: PluginMethod;
  result?: unknown;
  error?: PluginError;
  timestamp: number;
}

export interface FileEditResult {
  path: string;
  changed: boolean;
  lineCount: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: number;
}

export interface FileListResult {
  entries: FileEntry[];
}

export interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface PluginStatusResult {
  connected: boolean;
  softwareName: string;
  softwareVersion: string;
  pluginVersion: string;
  uptimeMs: number;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  code?: string;
}

export const PLUGIN_HEARTBEAT_INTERVAL_MS = 10_000;

let _idCounter = 0;
export function generateId(): string {
  _idCounter += 1;
  return `cu_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}
