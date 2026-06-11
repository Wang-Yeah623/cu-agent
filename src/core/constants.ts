/**
 * Cu Agent — 全局常量
 */

export const APP_NAME = "Cu Agent";
export const APP_VERSION = "0.1.0";

/* ===== 路径 ===== */

export const DEFAULT_WORKSPACE_ROOT = process.cwd();
export const CONFIG_DIR = ".cu-agent";
export const CONFIG_FILE = "config.json";
export const PROJECTS_DIR = "projects";

/* ===== 执行循环 ===== */

/** 两次进度检测之间的最小间隔（ms） */
export const PROGRESS_CHECK_MIN_INTERVAL_MS = 5_000;

/** 等待用户微信回复的超时时间 */
export const USER_INPUT_TIMEOUT_MS = 600_000; // 10 min

/** 执行子任务的最长时间 */
export const TASK_EXECUTION_TIMEOUT_MS = 600_000; // 10 min

/** 单个终端命令的最大执行时间 */
export const TERMINAL_COMMAND_TIMEOUT_MS = 120_000; // 2 min

/** 文件操作超时 */
export const FILE_OPERATION_TIMEOUT_MS = 30_000;

/* ===== 进度检测 ===== */

/** 进度检测中各维度的权重 */
export const PROGRESS_WEIGHTS = {
  REQUIREMENT_COVERAGE: 0.4,  // 需求覆盖度 40%
  FILE_OUTPUT: 0.2,           // 文件产出 20%
  RUNNABILITY: 0.25,          // 可运行性 25%
  CODE_QUALITY: 0.1,          // 代码质量 10%
  USER_FEEDBACK: 0.05,        // 用户反馈 5%
} as const;

/* ===== 通信 ===== */

export const WECHAT_MESSAGE_MAX_LENGTH = 2048;
export const WECHAT_RETRY_INTERVAL_MS = 3_000;
export const WECHAT_MAX_RETRIES = 3;

/* ===== 安全 ===== */

/** 禁止执行的终端命令 */
export const DANGEROUS_COMMANDS: readonly string[] = [
  "rm -rf /",
  "rm -rf ~",
  "rmdir /s",
  "del /f /s",
  "format ",
  "mkfs",
  "dd if=",
  ":(){ :|:& };:",
  "chmod -R 777",
  "chown -R",
  "> /dev/sda",
];

/** 允许执行命令的最大长度 */
export const MAX_COMMAND_LENGTH = 5000;

/** 操作审计日志保留天数 */
export const AUDIT_LOG_RETENTION_DAYS = 30;
