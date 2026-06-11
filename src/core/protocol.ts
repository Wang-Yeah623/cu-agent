/**
 * Cu Agent — 插件通信协议
 *
 * 职责：定义 Cu Agent Host 与 各软件 Plugin 之间的 WebSocket 通信协议。
 * 约束：协议必须双向兼容，Host → Plugin 为请求，Plugin → Host 为响应 + 事件推送。
 */

import { z } from "zod";

/* ===== 消息类型 ===== */

export enum PluginMessageType {
  /* Host → Plugin：请求 */
  REQUEST = "request",

  /* Plugin → Host：请求的响应 */
  RESPONSE = "response",

  /* Plugin → Host：主动事件推送（文件变更、错误等） */
  EVENT = "event",

  /* Host → Plugin：心跳 */
  PING = "ping",

  /* Plugin → Host：心跳回复 */
  PONG = "pong",
}

/* ===== 请求方法 ===== */

export enum PluginMethod {
  // 文件操作
  FILE_CREATE = "file.create",
  FILE_READ = "file.read",
  FILE_EDIT = "file.edit",
  FILE_DELETE = "file.delete",
  FILE_LIST = "file.list",

  // 终端操作
  TERMINAL_EXEC = "terminal.exec",
  TERMINAL_EXEC_STREAM = "terminal.execStream",
  TERMINAL_STOP = "terminal.stop",

  // IDE 操作
  IDE_OPEN_FILE = "ide.openFile",
  IDE_GET_OPEN_FILES = "ide.getOpenFiles",
  IDE_GET_SELECTION = "ide.getSelection",
  IDE_SET_SELECTION = "ide.setSelection",
  IDE_GET_DIAGNOSTICS = "ide.getDiagnostics",

  // 插件状态
  PLUGIN_STATUS = "plugin.status",
  PLUGIN_PING = "plugin.ping",
}

/* ===== 基础消息结构 ===== */

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

export interface PluginError {
  code: string;
  message: string;
  stack?: string;
}

/* ===== 请求 ===== */

export interface PluginRequest {
  type: PluginMessageType.REQUEST;
  id: string;
  method: PluginMethod;
  params: Record<string, unknown>;
  timestamp: number;
}

/* ===== 响应 ===== */

export interface PluginResponse {
  type: PluginMessageType.RESPONSE;
  id: string;
  method: PluginMethod;
  result?: unknown;
  error?: PluginError;
  timestamp: number;
}

/* ===== 事件推送 ===== */

export enum PluginEvent {
  FILE_CHANGED = "file.changed",
  DIAGNOSTICS_UPDATED = "diagnostics.updated",
  TERMINAL_OUTPUT = "terminal.output",
  PLUGIN_ERROR = "plugin.error",
  PLUGIN_READY = "plugin.ready",
  PLUGIN_CLOSING = "plugin.closing",
}

/* ===== 各方法的参数/返回值类型 ===== */

// file.create
export interface FileCreateParams {
  path: string;
  content: string;
  overwrite?: boolean;
}
export interface FileCreateResult {
  path: string;
  size: number;
}

// file.read
export interface FileReadParams {
  path: string;
}
export interface FileReadResult {
  content: string;
  size: number;
}

// file.edit
export interface FileEditParams {
  path: string;
  oldText: string;
  newText: string;
}
export interface FileEditResult {
  path: string;
  changed: boolean;
  lineCount: number;
}

// file.delete
export interface FileDeleteParams {
  path: string;
  force?: boolean;
}
export interface FileDeleteResult {
  path: string;
  deleted: boolean;
}

// file.list
export interface FileListParams {
  dir: string;
  recursive?: boolean;
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

// terminal.exec
export interface TerminalExecParams {
  command: string;
  cwd: string;
  timeout?: number;
}
export interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

// ide.openFile
export interface IdeOpenFileParams {
  path: string;
  line?: number;
  column?: number;
}

// ide.getDiagnostics
export interface IdeGetDiagnosticsParams {
  path?: string;
}
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
  code?: string;
}
export interface IdeGetDiagnosticsResult {
  diagnostics: Diagnostic[];
}

// plugin.status
export interface PluginStatusResult {
  connected: boolean;
  softwareName: string;
  softwareVersion: string;
  pluginVersion: string;
  uptimeMs: number;
}

/* ===== Zod Schemas ===== */

export const PluginMessageSchema = z.object({
  type: z.nativeEnum(PluginMessageType),
  id: z.string(),
  method: z.nativeEnum(PluginMethod).optional(),
  params: z.record(z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
  event: z.string().optional(),
  eventData: z.unknown().optional(),
  timestamp: z.number(),
});

export const PluginRequestSchema = z.object({
  type: z.literal(PluginMessageType.REQUEST),
  id: z.string(),
  method: z.nativeEnum(PluginMethod),
  params: z.record(z.unknown()),
  timestamp: z.number(),
});

export const PluginResponseSchema = z.object({
  type: z.literal(PluginMessageType.RESPONSE),
  id: z.string(),
  method: z.nativeEnum(PluginMethod),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
  timestamp: z.number(),
});

/* ===== 超时配置 ===== */

export const PLUGIN_DEFAULT_TIMEOUT_MS = 30_000;
export const PLUGIN_LONG_TIMEOUT_MS = 300_000; // 5 min for terminal exec
export const PLUGIN_HEARTBEAT_INTERVAL_MS = 10_000;
export const PLUGIN_HEARTBEAT_TIMEOUT_MS = 30_000;
export const PLUGIN_RECONNECT_INTERVAL_MS = 2_000;
export const PLUGIN_MAX_RECONNECT_ATTEMPTS = 10;
