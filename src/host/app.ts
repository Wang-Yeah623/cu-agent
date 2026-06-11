/**
 * Cu Agent — 应用主入口（Host）
 *
 * 职责：组装所有模块，启动服务，处理生命周期。
 *
 * 启动顺序：
 * 1. 加载配置
 * 2. 初始化 Hermes 客户端
 * 3. 初始化 插件注册表 + 安全门控
 * 4. 初始化 执行层（Codex 适配器、终端、文件系统）
 * 5. 初始化 执行循环器
 * 6. 初始化 WeChat Clawbot 桥接
 * 7. 启动 HTTP 服务（接收微信回调）
 * 8. 等待连接和指令
 */

import * as http from "http";
import * as path from "path";
import * as fs from "fs";

import { HermesClient } from "../hermes/client";
import { IntentParser } from "../hermes/intent-parser";
import { TaskPlanner } from "../hermes/task-planner";
import { ProgressDetector } from "../hermes/progress-detector";
import { PluginRegistry } from "../registry/registry";
import { SecurityGate } from "../registry/security";
import { CodexAdapter } from "../executor/codex-adapter";
import { TerminalAdapter } from "../executor/terminal";
import { FileSystemAdapter } from "../executor/filesystem";
import { ExecutionLoop } from "../loop/execution-loop";
import { ClawbotBridge, ClawbotConfig } from "../wechat/bridge";
import { MessageRouter } from "../wechat/message-handler";

import { APP_NAME, APP_VERSION, CONFIG_DIR, CONFIG_FILE } from "../core/constants";

export interface HostConfig {
  hermes: {
    apiEndpoint: string;
    apiKey?: string;
    modelName?: string;
  };
  wechat: ClawbotConfig;
  codex: {
    host: string;
    port: number;
  };
  workspace: {
    root: string;
  };
  http?: {
    port: number;
  };
}

export interface RuntimeContext {
  hermes: HermesClient;
  intentParser: IntentParser;
  taskPlanner: TaskPlanner;
  progressDetector: ProgressDetector;
  registry: PluginRegistry;
  securityGate: SecurityGate;
  codexAdapter: CodexAdapter;
  terminal: TerminalAdapter;
  fileSystem: FileSystemAdapter;
  executionLoop: ExecutionLoop;
  bridge: ClawbotBridge;
  messageRouter: MessageRouter;
}

/**
 * Cu Agent Host 应用
 *
 * 组装所有模块并启动服务。
 * 支持按需启动/停止，适合桌面应用嵌入。
 */
export class CuAgentHost {
  private config: HostConfig;
  private context: RuntimeContext | null = null;
  private httpServer: http.Server | null = null;
  private running: boolean = false;

  private constructor(config: HostConfig) {
    this.config = config;
  }

  /**
   * 工厂方法：从配置文件加载
   */
  public static async fromConfig(configPath?: string): Promise<CuAgentHost> {
    const config = await loadConfig(configPath);
    return new CuAgentHost(config);
  }

  /**
   * 工厂方法：直接传入配置
   */
  public static fromConfigObject(config: HostConfig): CuAgentHost {
    return new CuAgentHost(config);
  }

  /**
   * 启动 Cu Agent
   */
  public async start(): Promise<void> {
    if (this.running) {
      console.warn("[CuAgent] Already running");
      return;
    }

    console.log(`[CuAgent] ${APP_NAME} v${APP_VERSION} 正在启动...`);

    try {
      // Step 1: 初始化 Hermes 客户端
      const hermes = new HermesClient({
        apiEndpoint: this.config.hermes.apiEndpoint,
        apiKey: this.config.hermes.apiKey,
        modelName: this.config.hermes.modelName,
      });

      // Step 2: 初始化 Hermes 子模块
      const intentParser = new IntentParser(hermes);
      const taskPlanner = new TaskPlanner(hermes);
      const progressDetector = new ProgressDetector(hermes);

      // Step 3: 初始化插件注册表和安全门控
      const registry = new PluginRegistry();
      const securityGate = new SecurityGate();
      securityGate.addAllowedPath(this.config.workspace.root);

      // Step 4: 初始化执行层
      const codexAdapter = new CodexAdapter(
        this.config.codex.host,
        this.config.codex.port
      );
      const terminal = new TerminalAdapter(this.config.workspace.root);
      const fileSystem = new FileSystemAdapter();

      // Step 5: 初始化执行循环器
      const executionLoop = new ExecutionLoop(
        hermes,
        taskPlanner,
        progressDetector,
        codexAdapter,
        terminal,
        fileSystem,
        securityGate
      );

      // Step 6: 初始化 WeChat 通信层
      const bridge = new ClawbotBridge(this.config.wechat);
      const messageRouter = new MessageRouter(intentParser, bridge);

      // Step 7: 注册项目请求处理器
      messageRouter.on("project:request", async (msg: any) => {
        const project = await executionLoop.createProject(msg.content, this.config.workspace.root);
        if (project) {
          messageRouter.registerUser(msg.fromUser, executionLoop);
          await bridge.sendText(`✅ 项目「${project.name}」已创建，开始执行...`);
          executionLoop.start().catch((err) => {
            console.error("[CuAgent] Execution loop error:", err);
          });
        }
      });

      // Step 7.5: 桥接执行循环事件 → WeChat 消息
      executionLoop.on("task:start", (task: any) => {
        bridge.sendText(`🔨 开始: ${task.name}`).catch(() => {});
      });
      executionLoop.on("task:complete", (task: any, snapshot: any) => {
        bridge.sendProgressReport(
          executionLoop.getProject()?.name ?? "项目",
          snapshot?.percentage ?? 0,
          [`${task.name}`],
          [snapshot?.nextTask ?? ""],
          snapshot?.deviationFlag ? ["检测到偏离"] : undefined
        ).catch(() => {});
      });
      executionLoop.on("task:fail", (task: any, error: string) => {
        bridge.sendText(`❌ 任务失败: ${task.name}\n${error.slice(0, 200)}`).catch(() => {});
      });
      executionLoop.on("user:question", (question: string) => {
        bridge.sendText(`🤔 ${question}`).catch(() => {});
      });
      executionLoop.on("user:approval", (approvalId: string, description: string) => {
        bridge.sendText(`⚠️ 需要您的确认：${description}\n请回复「可以」或「不行」`).catch(() => {});
      });
      executionLoop.on("loop:complete", (project: any) => {
        bridge.sendText(`🎉 项目「${project.name}」已完成！\n文件在: ${project.outputDir}`).catch(() => {});
      });
      executionLoop.on("loop:error", (err: Error) => {
        bridge.sendText(`❌ 执行出错: ${err.message.slice(0, 200)}`).catch(() => {});
      });
      executionLoop.on("log", (entry: any) => {
        // 将错误和警告级别日志推送到微信
        if (entry.level === "error" || entry.level === "warn") {
          bridge.sendText(`${entry.level === "error" ? "❌" : "⚠️"} ${entry.message.slice(0, 300)}`).catch(() => {});
        }
        console.log(`[${entry.level}] ${entry.message}`);
      });

      // 保存运行时上下文
      this.context = {
        hermes,
        intentParser,
        taskPlanner,
        progressDetector,
        registry,
        securityGate,
        codexAdapter,
        terminal,
        fileSystem,
        executionLoop,
        bridge,
        messageRouter,
      };

      // Step 8: 连接 WeChat Clawbot
      const bridgeConnected = await bridge.connect();
      if (bridgeConnected) {
        console.log("[CuAgent] WeChat Clawbot 已连接");
      } else {
        console.warn("[CuAgent] WeChat Clawbot 连接失败，请检查 webhook URL");
      }

      // Step 9: 启动 HTTP 服务（用于接收微信回调）
      this.startHttpServer();

      this.running = true;
      console.log(`[CuAgent] ${APP_NAME} 启动完成 🚀`);
      console.log(`[CuAgent] 工作目录: ${this.config.workspace.root}`);
      console.log(`[CuAgent] HTTP 端口: ${this.config.http?.port ?? 3456}`);
    } catch (error) {
      console.error("[CuAgent] 启动失败:", error);
      throw error;
    }
  }

  /**
   * 停止应用
   */
  public async stop(): Promise<void> {
    if (!this.running) return;

    console.log("[CuAgent] 正在停止...");

    // 停止执行循环
    this.context?.executionLoop.stop();

    // 断开微信桥接
    this.context?.bridge.disconnect();

    // 关闭 HTTP 服务器
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }

    // 断开 Codex
    await this.context?.codexAdapter.disconnect();

    this.running = false;
    console.log("[CuAgent] 已停止");
  }

  /**
   * 获取运行时上下文（供外部集成使用）
   */
  public getContext(): RuntimeContext | null {
    return this.context;
  }

  /**
   * 是否正在运行
   */
  public get isRunning(): boolean {
    return this.running;
  }

  /**
   * 启动 HTTP 服务器（接收微信回调）
   */
  private startHttpServer(): void {
    const port = this.config.http?.port ?? 3456;

    this.httpServer = http.createServer(async (req, res) => {
      // CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // 健康检查
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: APP_VERSION }));
        return;
      }

      // 微信回调
      if (req.method === "POST" && req.url === "/wechat/callback") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const parsed = JSON.parse(body);
            const message = this.context?.messageRouter;
            if (message) {
              // 解析为 WeChatMessage
              const wechatMsg = this.context?.bridge.receive(parsed);
              if (wechatMsg) {
                await message.handleMessage(wechatMsg);
              }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code: 0 }));
          } catch {
            res.writeHead(400);
            res.end("Invalid JSON");
          }
        });
        return;
      }

      // 插件状态查询
      if (req.method === "GET" && req.url === "/api/plugins") {
        const registry = this.context?.registry;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          bindings: registry?.getAllBindings() ?? [],
          connected: registry?.getConnectedPlugins().length ?? 0,
        }));
        return;
      }

      // 项目状态查询
      if (req.method === "GET" && req.url === "/api/status") {
        const loop = this.context?.executionLoop;
        const progress = loop?.getCurrentProgress();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          running: this.running,
          state: loop?.getProject()?.status ?? "idle",
          progress: progress ?? null,
        }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    this.httpServer.listen(port, "127.0.0.1", () => {
      console.log(`[CuAgent] HTTP 服务已启动: http://127.0.0.1:${port}`);
    });

    this.httpServer.on("error", (err) => {
      console.error(`[CuAgent] HTTP 服务启动失败:`, err);
    });
  }
}

/**
 * 从文件中加载配置
 */
async function loadConfig(configPath?: string): Promise<HostConfig> {
  const defaultPath = path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    CONFIG_DIR,
    CONFIG_FILE
  );

  const resolvedPath = configPath ?? defaultPath;

  if (fs.existsSync(resolvedPath)) {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed as HostConfig;
  }

  // 默认配置
  const defaultConfig: HostConfig = {
    hermes: {
      apiEndpoint: "http://localhost:11434",  // Ollama 默认
      modelName: "hermes-3-llama-3.1-8b",
    },
    wechat: {
      webhookUrl: "",  // 用户在配置文件中填写
    },
    codex: {
      host: "127.0.0.1",
      port: 9876,
    },
    workspace: {
      root: process.cwd(),
    },
    http: {
      port: 3456,
    },
  };

  return defaultConfig;
}
