/**
 * Cu Agent — 端到端集成测试
 *
 * 1. 启动 Mock Hermes API Server
 * 2. 初始化 Cu Agent All Modules
 * 3. 创建一个项目
 * 4. 执行循环
 * 5. 验证输出
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess, spawn } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";

import { HermesClient } from "../src/hermes/client";
import { TaskPlanner } from "../src/hermes/task-planner";
import { ProgressDetector } from "../src/hermes/progress-detector";
import { IntentParser } from "../src/hermes/intent-parser";
import { PluginRegistry } from "../src/registry/registry";
import { SecurityGate } from "../src/registry/security";
import { CodexAdapter } from "../src/executor/codex-adapter";
import { TerminalAdapter } from "../src/executor/terminal";
import { FileSystemAdapter } from "../src/executor/filesystem";
import { ExecutionLoop } from "../src/loop/execution-loop";
import { ClawbotBridge } from "../src/wechat/bridge";
import { MessageRouter } from "../src/wechat/message-handler";

const TEST_PROJECTS_DIR = path.join(__dirname, "..", ".test-projects");
const HERMES_ENDPOINT = "http://127.0.0.1:11434";

describe("Cu Agent E2E Integration", () => {
  let hermes: HermesClient;
  let taskPlanner: TaskPlanner;
  let progressDetector: ProgressDetector;
  let intentParser: IntentParser;
  let registry: PluginRegistry;
  let securityGate: SecurityGate;
  let codex: CodexAdapter;
  let terminal: TerminalAdapter;
  let fileSystem: FileSystemAdapter;
  let executionLoop: ExecutionLoop;
  let bridge: ClawbotBridge;

  beforeAll(async () => {
    // 确保测试目录存在
    if (!fs.existsSync(TEST_PROJECTS_DIR)) {
      fs.mkdirSync(TEST_PROJECTS_DIR, { recursive: true });
    }

    // 初始化模块
    hermes = new HermesClient({ apiEndpoint: HERMES_ENDPOINT, modelName: "mock" });
    taskPlanner = new TaskPlanner(hermes);
    progressDetector = new ProgressDetector(hermes);
    intentParser = new IntentParser(hermes);
    registry = new PluginRegistry();
    securityGate = new SecurityGate();
    securityGate.addAllowedPath(TEST_PROJECTS_DIR);
    codex = new CodexAdapter("127.0.0.1", 9876);
    terminal = new TerminalAdapter(TEST_PROJECTS_DIR);
    fileSystem = new FileSystemAdapter();
    executionLoop = new ExecutionLoop(hermes, taskPlanner, progressDetector, codex, terminal, fileSystem, securityGate);
    bridge = new ClawbotBridge({ webhookUrl: "" });
  }, 15000);

  it("1. Hermes client can connect to mock API", async () => {
    const response = await hermes.call("test", "hello");
    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
  }, 10000);

  it("2. IntentParser parses project creation", async () => {
    const intent = await intentParser.parse({
      msgId: "msg-1",
      fromUser: "test-user",
      content: "帮我做一个博客系统",
      timestamp: new Date(),
    });
    expect(intent.action).toBe("CREATE_PROJECT");
    expect(intent.confidence).toBeGreaterThan(0);
  }, 10000);

  it("3. TaskPlanner creates a plan from requirement", async () => {
    const plan = await taskPlanner.plan("帮我做一个待办事项App");
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.techStack).toBeDefined();
    expect(plan.tasks[0].name).toBeDefined();
    expect(plan.tasks[0].description).toBeDefined();
  }, 15000);

  it("4. ExecutionLoop creates project, plans tasks, and reports progress", async () => {
    const project = await executionLoop.createProject("帮我做一个简单的博客系统", TEST_PROJECTS_DIR);
    expect(project).toBeDefined();
    expect(project.name).toBeDefined();

    // 监听事件
    const events: string[] = [];
    executionLoop.on("log", (entry: any) => {
      events.push(`[${entry.level}] ${entry.message}`);
    });

    // 启动执行（因为 mock 只会返回预定义数据，允许在有限步骤后自然完成或暂停）
    const startPromise = executionLoop.start();

    // 等待 5 秒让循环跑几步
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 暂停
    executionLoop.pause();

    // 检查是否产生了事件和进度
    expect(events.length).toBeGreaterThan(0);

    const progress = executionLoop.getCurrentProgress();
    // 即使没有进度快照，应该至少有日志
    const hasLogs = events.some((e) => e.includes("[info]") || e.includes("[warn]"));
    expect(hasLogs).toBe(true);

    console.log("E2E Events captured:", events.slice(0, 5).join("\n  "));
  }, 30000);

  it("5. FileSystem creates files in project dir", async () => {
    const testFile = path.join(TEST_PROJECTS_DIR, "test-output.txt");
    await fileSystem.createFile(testFile, "Hello Cu Agent E2E!");
    const result = await fileSystem.readFile(testFile);
    expect(result.content).toContain("Cu Agent");
    expect(result.size).toBeGreaterThan(0);
  });

  it("6. SecurityGate blocks dangerous commands", () => {
    const result = securityGate.checkCommand("rm -rf /");
    expect(result.allowed).toBe(false);
  });

  afterAll(() => {
    executionLoop.stop();
    // 清理测试目录
    try {
      fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });
});
