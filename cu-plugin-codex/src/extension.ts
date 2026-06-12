/**
 * Cu Plugin for Codex — VS Code 扩展入口
 *
 * 在编辑器内开一个本地 WebSocket 服务（默认 9876），接收 Cu Agent Host 的操控指令，
 * 在编辑器里执行文件 / 终端 / IDE 操作。
 */

import { WebSocketServer, WebSocket, RawData } from "ws";
import * as vscode from "vscode";
import {
  PluginMessage,
  PluginMessageType,
  PluginMethod,
  PluginResponse,
  PluginEvent,
  PLUGIN_HEARTBEAT_INTERVAL_MS,
  generateId,
  FileEditResult,
  FileListResult,
  FileEntry,
  TerminalExecResult,
  PluginStatusResult,
  Diagnostic,
} from "./protocol";

let plugin: CuCodexPlugin | undefined;

/** VS Code 加载扩展时调用 */
export function activate(context: vscode.ExtensionContext): void {
  const port = vscode.workspace.getConfiguration("cuAgent").get<number>("port", 9876);
  plugin = new CuCodexPlugin(port);
  plugin.activate(context);
}

/** VS Code 卸载扩展时调用 */
export function deactivate(): void {
  plugin?.deactivate();
  plugin = undefined;
}

/**
 * Cu Plugin 核心：WebSocket 服务 + 指令分发。
 */
export class CuCodexPlugin {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private port: number;
  private bindingKey: string;
  private startedAt: number = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(port: number = 9876) {
    this.port = port;
    this.bindingKey = generateId();
  }

  public activate(context: vscode.ExtensionContext): void {
    console.log("[Cu Plugin] Activating...");
    this.startedAt = Date.now();

    vscode.window.showInformationMessage(
      `Cu Agent Plugin 已启动 — 端口 ${this.port}，绑定密钥 ${this.bindingKey}`
    );

    this.startWebSocketServer();

    context.subscriptions.push(
      vscode.commands.registerCommand("cuAgent.showBindingKey", () => {
        vscode.window.showInformationMessage(
          `绑定密钥：${this.bindingKey}\n端口：${this.port}`
        );
      }),
      vscode.commands.registerCommand("cuAgent.showStatus", () => {
        const s = this.getPluginStatus();
        vscode.window.showInformationMessage(
          `Cu Plugin：${s.connected ? "Host 已连接" : "等待 Host 连接"} · 端口 ${this.port} · 运行 ${Math.round(s.uptimeMs / 1000)}s`
        );
      }),
      { dispose: () => this.deactivate() }
    );

    console.log(`[Cu Plugin] Activated on port ${this.port}, key: ${this.bindingKey}`);
  }

  private startWebSocketServer(): void {
    this.wss = new WebSocketServer({ port: this.port, host: "127.0.0.1" });

    this.wss.on("listening", () => {
      console.log(`[Cu Plugin] WebSocket server listening on 127.0.0.1:${this.port}`);
    });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("[Cu Plugin] Host connected");
      this.client = ws;
      this.startHeartbeat();

      ws.on("message", (data: RawData) => {
        try {
          const message: PluginMessage = JSON.parse(data.toString());
          void this.handleMessage(message, ws);
        } catch {
          this.sendError(ws, "parse_error", "Failed to parse message", generateId());
        }
      });

      ws.on("close", () => {
        console.log("[Cu Plugin] Host disconnected");
        this.client = null;
        this.stopHeartbeat();
      });

      ws.on("error", (error: Error) => {
        console.error("[Cu Plugin] WebSocket error:", error);
        this.client = null;
        this.stopHeartbeat();
      });

      this.sendEvent(ws, PluginEvent.PLUGIN_READY, {
        softwareName: "VS Code",
        softwareVersion: vscode.version,
        pluginVersion: "0.1.0",
      });
    });

    this.wss.on("error", (error: Error) => {
      console.error("[Cu Plugin] Server error:", error);
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        vscode.window.showErrorMessage(
          `端口 ${this.port} 已被占用，Cu Plugin 无法启动。可在设置 cuAgent.port 里改端口。`
        );
      }
    });
  }

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

  private async handleRequest(message: PluginMessage, ws: WebSocket): Promise<void> {
    const { id, method, params } = message;
    try {
      let result: unknown;
      switch (method) {
        case PluginMethod.FILE_CREATE: result = await vscodeFileCreate(params); break;
        case PluginMethod.FILE_READ: result = await vscodeFileRead(params); break;
        case PluginMethod.FILE_EDIT: result = await vscodeFileEdit(params); break;
        case PluginMethod.FILE_DELETE: result = await vscodeFileDelete(params); break;
        case PluginMethod.FILE_LIST: result = await vscodeFileList(params); break;
        case PluginMethod.TERMINAL_EXEC: result = await vscodeTerminalExec(params); break;
        case PluginMethod.IDE_OPEN_FILE: result = await vscodeOpenFile(params); break;
        case PluginMethod.IDE_GET_OPEN_FILES: result = await vscodeGetOpenFiles(); break;
        case PluginMethod.IDE_GET_DIAGNOSTICS: result = await vscodeGetDiagnostics(params); break;
        case PluginMethod.PLUGIN_STATUS: result = this.getPluginStatus(); break;
        default:
          this.sendError(ws, "not_implemented", `Method not implemented: ${method}`, id);
          return;
      }
      this.sendResponse(ws, id, method!, result);
    } catch (error) {
      this.sendError(ws, "execution_error", error instanceof Error ? error.message : String(error), id);
    }
  }

  private sendResponse(ws: WebSocket, id: string, method: PluginMethod, result: unknown): void {
    const response: PluginResponse = {
      type: PluginMessageType.RESPONSE, id, method, result, timestamp: Date.now(),
    };
    ws.send(JSON.stringify(response));
  }

  private sendError(ws: WebSocket, code: string, message: string, id: string): void {
    const response: PluginResponse = {
      type: PluginMessageType.RESPONSE, id, method: PluginMethod.PLUGIN_STATUS,
      error: { code, message }, timestamp: Date.now(),
    };
    ws.send(JSON.stringify(response));
  }

  private sendEvent(ws: WebSocket, event: PluginEvent, data: unknown): void {
    const message: PluginMessage = {
      type: PluginMessageType.EVENT, id: generateId(), event, eventData: data, timestamp: Date.now(),
    };
    ws.send(JSON.stringify(message));
  }

  private sendPong(ws: WebSocket, id: string): void {
    ws.send(JSON.stringify({ type: PluginMessageType.PONG, id, timestamp: Date.now() }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify({ type: PluginMessageType.PING, id: generateId(), timestamp: Date.now() }));
      }
    }, PLUGIN_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private getPluginStatus(): PluginStatusResult {
    return {
      connected: this.client !== null,
      softwareName: "VS Code",
      softwareVersion: vscode.version,
      pluginVersion: "0.1.0",
      uptimeMs: Date.now() - this.startedAt,
    };
  }

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

function ws_path() {
  return require("path") as typeof import("path");
}
function ws_fs() {
  return require("fs") as typeof import("fs");
}

async function vscodeFileCreate(params: any): Promise<{ path: string; size: number }> {
  const fs = ws_fs();
  const pathMod = ws_path();
  const filePath = pathMod.resolve(params.path);
  fs.mkdirSync(pathMod.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, params.content ?? "", "utf-8");
  const stats = fs.statSync(filePath);
  await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  return { path: filePath, size: stats.size };
}

async function vscodeFileRead(params: any): Promise<{ content: string; size: number }> {
  const fs = ws_fs();
  const filePath = ws_path().resolve(params.path);
  const content = fs.readFileSync(filePath, "utf-8");
  const stats = fs.statSync(filePath);
  return { content, size: stats.size };
}

async function vscodeFileEdit(params: any): Promise<FileEditResult> {
  const fs = ws_fs();
  const filePath = ws_path().resolve(params.path);
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes(params.oldText)) {
    throw new Error(`oldText not found in file: ${params.oldText}`);
  }
  const updated = content.replace(params.oldText, params.newText);
  fs.writeFileSync(filePath, updated, "utf-8");
  return { path: filePath, changed: content !== updated, lineCount: updated.split("\n").length };
}

async function vscodeFileDelete(params: any): Promise<{ path: string; deleted: boolean }> {
  const fs = ws_fs();
  const filePath = ws_path().resolve(params.path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return { path: filePath, deleted: true };
}

async function vscodeFileList(params: any): Promise<FileListResult> {
  const fs = ws_fs();
  const pathMod = ws_path();
  const dirPath = pathMod.resolve(params.dir);
  if (!fs.existsSync(dirPath)) return { entries: [] };
  const entries: FileEntry[] = fs.readdirSync(dirPath).map((name: string) => {
    const stats = fs.statSync(pathMod.join(dirPath, name));
    return {
      name, path: name, isDirectory: stats.isDirectory(),
      size: stats.isFile() ? stats.size : undefined, lastModified: stats.mtimeMs,
    };
  });
  return { entries };
}

async function vscodeTerminalExec(params: any): Promise<TerminalExecResult> {
  // 用 VS Code 内置终端执行；Terminal API 无法直接取回输出，返回占位结果。
  const terminal = vscode.window.createTerminal("Cu Agent");
  terminal.show();
  terminal.sendText(params.command);
  return {
    stdout: `Command "${params.command}" sent to VS Code terminal`,
    stderr: "", exitCode: 0, durationMs: 0,
  };
}

async function vscodeOpenFile(params: any): Promise<void> {
  const filePath = ws_path().resolve(params.path);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
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
  const uri = params.path ? vscode.Uri.file(ws_path().resolve(params.path)) : undefined;
  const pairs = uri
    ? [[uri, vscode.languages.getDiagnostics(uri)] as const]
    : vscode.languages.getDiagnostics();
  const diagnostics: Diagnostic[] = [];
  for (const [fileUri, entries] of pairs) {
    for (const diag of entries) {
      diagnostics.push({
        file: fileUri.fsPath,
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        message: diag.message,
        severity:
          diag.severity === vscode.DiagnosticSeverity.Error ? "error"
          : diag.severity === vscode.DiagnosticSeverity.Warning ? "warning"
          : "info",
      });
    }
  }
  return { diagnostics };
}
