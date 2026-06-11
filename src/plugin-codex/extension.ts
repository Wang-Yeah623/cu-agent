/**
 * Cu Agent — Codex 桌面版插件
 *
 * 职责：作为 VS Code / Codex 的 Extension，提供 WebSocket 服务器，
 * 接收 Cu Agent Host 的操控指令并执行。
 *
 * 说明：这是一个 TypeScript 模块化描述，实际运行需要编译为 VS Code Extension。
 * 以下为核心逻辑骨架。
 */

import { WebSocketServer, WebSocket } from "ws";
import * as vscode from "vscode";       // VS Code API（实际扩展中使用）
import {
  PluginMessage,
  PluginMessageType,
  PluginMethod,
  PluginResponse,
  PluginEvent,
  PLUGIN_DEFAULT_TIMEOUT_MS,
  PLUGIN_HEARTBEAT_INTERVAL_MS,
  PLUGIN_HEARTBEAT_TIMEOUT_MS,
  generateId,
  now,
  FileEditResult,
  FileListResult,
  FileEntry,
  TerminalExecResult,
  PluginStatusResult,
  Diagnostic,
} from "../../core";

/**
 * Cu Plugin for Codex 的核心类
 *
 * 生命周期：
 * 1. activate() — Extension 被 Codex 加载时调用
 * 2. WebSocket 服务器启动，等待 Cu Agent Host 连接
 * 3. 收到绑定请求后建立安全连接
 * 4. 处理来自 Host 的操控请求
 * 5. deactivate() — Extension 被卸载时关闭
 */
export class CuCodexPlugin {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private port: number;
  private bindingKey: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(port: number = 9876) {
    this.port = port;
    this.bindingKey = generateId(); // 每次启动生成新密钥
  }

  /**
   * 启动 WebSocket 服务器
   * 在 VS Code activate() 中调用
   */
  public async activate(context: vscode.ExtensionContext): Promise<void> {
    console.log("[Cu Plugin] Activating...");

    // 显示绑定信息
    vscode.window.showInformationMessage(
      `Cu Agent Plugin 已启动\n绑定密钥：${this.bindingKey}\n端口：${this.port}`
    );

    this.startWebSocketServer();

    // 注册 VS Code 命令
    context.subscriptions.push(
      vscode.commands.registerCommand("cuAgent.showBindingKey", () => {
        vscode.window.showInformationMessage(
          `绑定密钥：${this.bindingKey}\n请在 Cu Agent Host 中输入此密钥完成绑定。`
        );
      })
    );

    console.log(`[Cu Plugin] Activated on port ${this.port}, key: ${this.bindingKey}`);
  }

  /**
   * 启动 WebSocket 服务器，等待 Host 连接
   */
  private startWebSocketServer(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("listening", () => {
      console.log(`[Cu Plugin] WebSocket server listening on port ${this.port}`);
    });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("[Cu Plugin] Host connected");
      this.client = ws;
      this.startHeartbeat();

      ws.on("message", (data: Buffer) => {
        try {
          const message: PluginMessage = JSON.parse(data.toString());
          this.handleMessage(message, ws);
        } catch (error) {
          this.sendError(ws, "parse_error", "Failed to parse message", generateId());
        }
      });

      ws.on("close", () => {
        console.log("[Cu Plugin] Host disconnected");
        this.client = null;
        this.stopHeartbeat();
      });

      ws.on("error", (error) => {
        console.error("[Cu Plugin] WebSocket error:", error);
        this.client = null;
        this.stopHeartbeat();
      });

      // 发送就绪事件
      this.sendEvent(ws, PluginEvent.PLUGIN_READY, {
        softwareName: "Codex桌面版",
        softwareVersion: vscode.version,
        pluginVersion: "0.1.0",
      });
    });

    this.wss.on("error", (error) => {
      console.error("[Cu Plugin] Server error:", error);
      // 端口冲突时的降级
      if ((error as any).code === "EADDRINUSE") {
        vscode.window.showErrorMessage(
          `端口 ${this.port} 已被占用，Cu Plugin 无法启动`
        );
      }
    });
  }

  /**
   * 处理来自 Host 的请求
   */
  private async handleMessage(message: PluginMessage, ws: WebSocket): Promise<void> {
    switch (message.type) {
      case PluginMessageType.PING:
        this.sendPong(ws, message.id);
        return;

      case PluginMessageType.REQUEST:
        await this.handleRequest(message, ws);
        return;

      default:
        this.sendError(ws, "unknown_type", `Unknown message type: ${message.type}`, message.id);
    }
  }

  /**
   * 路由请求到具体处理器
   */
  private async handleRequest(
    message: PluginMessage,
    ws: WebSocket
  ): Promise<void> {
    const { id, method, params } = message;

    try {
      let result: unknown;

      switch (method) {
        // 文件操作
        case PluginMethod.FILE_CREATE:
          result = await vscodeFileCreate(params);
          break;
        case PluginMethod.FILE_READ:
          result = await vscodeFileRead(params);
          break;
        case PluginMethod.FILE_EDIT:
          result = await vscodeFileEdit(params);
          break;
        case PluginMethod.FILE_DELETE:
          result = await vscodeFileDelete(params);
          break;
        case PluginMethod.FILE_LIST:
          result = await vscodeFileList(params);
          break;

        // 终端操作
        case PluginMethod.TERMINAL_EXEC:
          result = await vscodeTerminalExec(params);
          break;

        // IDE 操作
        case PluginMethod.IDE_OPEN_FILE:
          result = await vscodeOpenFile(params);
          break;
        case PluginMethod.IDE_GET_OPEN_FILES:
          result = await vscodeGetOpenFiles();
          break;
        case PluginMethod.IDE_GET_DIAGNOSTICS:
          result = await vscodeGetDiagnostics(params);
          break;

        // 插件状态
        case PluginMethod.PLUGIN_STATUS:
          result = this.getPluginStatus();
          break;

        default:
          this.sendError(ws, "not_implemented", `Method not implemented: ${method}`, id);
          return;
      }

      this.sendResponse(ws, id, method, result);
    } catch (error) {
      this.sendError(
        ws,
        "execution_error",
        error instanceof Error ? error.message : String(error),
        id
      );
    }
  }

  /**
   * 发送响应给 Host
   */
  private sendResponse(ws: WebSocket, id: string, method: PluginMethod, result: unknown): void {
    const response: PluginResponse = {
      type: PluginMessageType.RESPONSE,
      id,
      method,
      result,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(response));
  }

  /**
   * 发送错误给 Host
   */
  private sendError(ws: WebSocket, code: string, message: string, id: string): void {
    const response: PluginResponse = {
      type: PluginMessageType.RESPONSE,
      id,
      method: PluginMethod.PLUGIN_STATUS,
      error: { code, message },
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(response));
  }

  /**
   * 发送事件给 Host
   */
  private sendEvent(ws: WebSocket, event: PluginEvent, data: unknown): void {
    const message: PluginMessage = {
      type: PluginMessageType.EVENT,
      id: generateId(),
      event,
      eventData: data,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(message));
  }

  /**
   * 发送心跳回复
   */
  private sendPong(ws: WebSocket, id: string): void {
    ws.send(
      JSON.stringify({
        type: PluginMessageType.PONG,
        id,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * 心跳保活
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        const ping = {
          type: PluginMessageType.PING,
          id: generateId(),
          timestamp: Date.now(),
        };
        this.client.send(JSON.stringify(ping));
      }
    }, PLUGIN_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 获取插件状态
   */
  private getPluginStatus(): PluginStatusResult {
    return {
      connected: this.client !== null,
      softwareName: "Codex桌面版",
      softwareVersion: vscode.version,
      pluginVersion: "0.1.0",
      uptimeMs: 0,
    };
  }

  /**
   * 关闭插件
   */
  public deactivate(): void {
    console.log("[Cu Plugin] Deactivating...");
    this.stopHeartbeat();
    this.client?.close();
    this.wss?.close();
    this.wss = null;
    this.client = null;
  }
}

/* ===== VS Code 操作实现 ===== */

async function vscodeFileCreate(params: any): Promise<{ path: string; size: number }> {
  const fs = require("fs");
  const path_mod = require("path");
  const filePath = path_mod.resolve(params.path);
  const dir = path_mod.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, params.content, "utf-8");
  const stats = fs.statSync(filePath);
  // 在 Codex 中打开新文件
  const uri = vscode.Uri.file(filePath);
  await vscode.workspace.openTextDocument(uri);
  return { path: filePath, size: stats.size };
}

async function vscodeFileRead(params: any): Promise<{ content: string; size: number }> {
  const fs = require("fs");
  const filePath = require("path").resolve(params.path);
  const content = fs.readFileSync(filePath, "utf-8");
  const stats = fs.statSync(filePath);
  return { content, size: stats.size };
}

async function vscodeFileEdit(params: any): Promise<FileEditResult> {
  const fs = require("fs");
  const filePath = require("path").resolve(params.path);
  const content = fs.readFileSync(filePath, "utf-8");

  if (!content.includes(params.oldText)) {
    throw new Error(`oldText not found in file: ${params.oldText}`);
  }

  const updated = content.replace(params.oldText, params.newText);
  fs.writeFileSync(filePath, updated, "utf-8");

  return {
    path: filePath,
    changed: content !== updated,
    lineCount: updated.split("\n").length,
  };
}

async function vscodeFileDelete(params: any): Promise<{ path: string; deleted: boolean }> {
  const fs = require("fs");
  const filePath = require("path").resolve(params.path);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return { path: filePath, deleted: true };
}

async function vscodeFileList(params: any): Promise<FileListResult> {
  const fs = require("fs");
  const path_mod = require("path");
  const dirPath = path_mod.resolve(params.dir);

  if (!fs.existsSync(dirPath)) {
    return { entries: [] };
  }

  const items = fs.readdirSync(dirPath);
  const entries: FileEntry[] = items.map((name: string) => {
    const fullPath = path_mod.join(dirPath, name);
    const stats = fs.statSync(fullPath);
    return {
      name,
      path: name,
      isDirectory: stats.isDirectory(),
      size: stats.isFile() ? stats.size : undefined,
      lastModified: stats.mtimeMs,
    };
  });

  return { entries };
}

async function vscodeTerminalExec(params: any): Promise<TerminalExecResult> {
  // 使用 VS Code 的内置终端执行命令
  const terminal = vscode.window.createTerminal("Cu Agent");
  terminal.show();
  terminal.sendText(params.command);

  // 由于 VS Code Terminal API 无法直接获取输出，
  // 这里返回一个占位结果。实际应用中应集成完整输出捕获。
  return {
    stdout: `Command "${params.command}" sent to VS Code terminal`,
    stderr: "",
    exitCode: 0,
    durationMs: 0,
  };
}

async function vscodeOpenFile(params: any): Promise<void> {
  const filePath = require("path").resolve(params.path);
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    selection: params.line
      ? new vscode.Range(params.line - 1, params.column ?? 0, params.line - 1, params.column ?? 0)
      : undefined,
  });
}

async function vscodeGetOpenFiles(): Promise<string[]> {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputText)
    .map((tab) => (tab.input as vscode.TabInputText).uri.fsPath);
}

async function vscodeGetDiagnostics(params: any): Promise<{ diagnostics: Diagnostic[] }> {
  const uri = params.path
    ? vscode.Uri.file(require("path").resolve(params.path))
    : undefined;

  const allDiagnostics = vscode.languages.getDiagnostics(uri);
  const diagnostics: Diagnostic[] = [];

  if (uri) {
    // 单个文件
    const entries = vscode.languages.getDiagnostics(uri);
    for (const diag of entries) {
      diagnostics.push({
        file: uri.fsPath,
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        message: diag.message,
        severity: diag.severity === vscode.DiagnosticSeverity.Error
          ? "error"
          : diag.severity === vscode.DiagnosticSeverity.Warning
          ? "warning"
          : "info",
      });
    }
  } else {
    // 所有文件
    for (const [fileUri, entries] of allDiagnostics) {
      for (const diag of entries) {
        diagnostics.push({
          file: fileUri.fsPath,
          line: diag.range.start.line + 1,
          column: diag.range.start.character + 1,
          message: diag.message,
          severity: diag.severity === vscode.DiagnosticSeverity.Error
            ? "error"
            : diag.severity === vscode.DiagnosticSeverity.Warning
            ? "warning"
            : "info",
        });
      }
    }
  }

  return { diagnostics };
}
