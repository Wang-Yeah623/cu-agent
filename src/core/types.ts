/**
 * Cu Agent — 核心类型定义
 *
 * 职责：所有模块共享的数据模型、枚举、接口。
 * 约束：不依赖任何其他模块，纯类型层。
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

/* ===== 枚举 ===== */

export enum ProjectStatus {
  IDLE = "idle",
  PLANNING = "planning",
  EXECUTING = "executing",
  WAITING_APPROVAL = "waiting_approval",
  WAITING_USER_INPUT = "waiting_user_input",
  PAUSED = "paused",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum TaskStatus {
  PENDING = "pending",
  EXECUTING = "executing",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped",
}

export enum ActionType {
  FILE_CREATE = "file.create",
  FILE_READ = "file.read",
  FILE_EDIT = "file.edit",
  FILE_DELETE = "file.delete",
  FILE_LIST = "file.list",
  TERMINAL_EXEC = "terminal.exec",
  IDE_OPEN_FILE = "ide.openFile",
  IDE_GET_DIAGNOSTICS = "ide.getDiagnostics",
  CODE_GENERATE = "code.generate",
  QUESTION_ASK = "question.ask",
  USER_RESPONSE = "user.response",
}

export enum DeviationLevel {
  NONE = "none",
  MINOR = "minor",
  MAJOR = "major",
  CRITICAL = "critical",
}

/* ===== 技术栈 ===== */

export interface TechStack {
  framework?: string;
  language?: string;
  styling?: string;
  database?: string;
  orm?: string;
}

/* ===== 项目 ===== */

export interface Project {
  id: string;
  name: string;
  requirement: string;
  requirementSummary: string;
  techStack: TechStack;
  outputDir: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

/* ===== 子任务 ===== */

export interface SubTask {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: TaskStatus;
  order: number;
  dependsOn: string[];
  actions: Action[];
  progressAtCompletion: number;
}

/* ===== 操作记录 ===== */

export interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface Action {
  id: string;
  subTaskId: string;
  type: ActionType;
  payload: Record<string, unknown>;
  result?: ActionResult;
  timestamp: Date;
}

/* ===== 进度快照 ===== */

export interface ProgressSnapshot {
  id: string;
  projectId: string;
  percentage: number;
  completedTaskCount: number;
  totalTaskCount: number;
  fileTree: string;
  summary: string;
  nextTask: string;
  deviationFlag: boolean;
  deviationLevel: DeviationLevel;
  needsUserInput: boolean;
  userQuestion?: string;
  createdAt: Date;
}

/* ===== 用户意图 ===== */

export enum UserIntentAction {
  CREATE_PROJECT = "CREATE_PROJECT",
  MODIFY_PLAN = "MODIFY_PLAN",
  REPORT_PROGRESS = "REPORT_PROGRESS",
  APPROVE = "APPROVE",
  PAUSE = "PAUSE",
  RESUME = "RESUME",
  SELECT_OPTION = "SELECT_OPTION",
  STOP = "STOP",
  CANCEL = "CANCEL",
  UNKNOWN = "UNKNOWN",
}

export interface UserIntent {
  action: UserIntentAction;
  confidence: number;
  target?: string;
  value?: string;
  rawText: string;
}

/* ===== 微信消息 ===== */

export interface WeChatMessage {
  msgId: string;
  fromUser: string;
  content: string;
  timestamp: Date;
}

export interface WeChatOutgoingMessage {
  msgType: "text" | "markdown";
  content: string;
}

/* ===== 插件绑定 ===== */

export interface PluginBinding {
  pluginId: string;
  softwareName: string;
  softwareVersion: string;
  bindingKey: string;
  webSocketPort: number;
  connected: boolean;
  boundAt: Date;
}

/* ===== 执行结果 ===== */

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  durationMs: number;
}

/* ===== 审批请求 ===== */

export interface ApprovalRequest {
  id: string;
  projectId: string;
  description: string;
  action: ActionType;
  payload: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  resolvedAt?: Date;
}

/* ===== Zod Schemas（运行时校验） ===== */

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  requirement: z.string().min(1),
  requirementSummary: z.string(),
  techStack: z.object({
    framework: z.string().optional(),
    language: z.string().optional(),
    styling: z.string().optional(),
    database: z.string().optional(),
    orm: z.string().optional(),
  }),
  outputDir: z.string(),
  status: z.nativeEnum(ProjectStatus),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SubTaskSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string(),
  status: z.nativeEnum(TaskStatus),
  order: z.number().int().min(0),
  dependsOn: z.array(z.string()),
  actions: z.array(z.lazy(() => ActionSchema)),
  progressAtCompletion: z.number().min(0).max(100),
});

export const ActionSchema = z.object({
  id: z.string().uuid(),
  subTaskId: z.string().uuid(),
  type: z.nativeEnum(ActionType),
  payload: z.record(z.unknown()),
  result: z
    .object({
      success: z.boolean(),
      output: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  timestamp: z.date(),
});

export const ProgressSnapshotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  percentage: z.number().min(0).max(100),
  completedTaskCount: z.number().int().min(0),
  totalTaskCount: z.number().int().min(1),
  fileTree: z.string(),
  summary: z.string(),
  nextTask: z.string(),
  deviationFlag: z.boolean(),
  deviationLevel: z.nativeEnum(DeviationLevel),
  needsUserInput: z.boolean(),
  userQuestion: z.string().optional(),
  createdAt: z.date(),
});

export const WeChatMessageSchema = z.object({
  msgId: z.string(),
  fromUser: z.string(),
  content: z.string(),
  timestamp: z.date(),
});

export const ApprovalRequestSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  description: z.string(),
  action: z.nativeEnum(ActionType),
  payload: z.record(z.unknown()),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.date(),
  resolvedAt: z.date().optional(),
});

/* ===== 常用工具函数 ===== */

export function generateId(): string {
  return uuidv4();
}

export function now(): Date {
  return new Date();
}
