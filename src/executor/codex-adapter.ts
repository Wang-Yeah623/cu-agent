/**
 * Cu Agent - Codex Desktop Plugin Adapter
 */
import { EventEmitter } from "events";
import { PluginMessage, PluginMessageType, PluginMethod, PluginRequest, PluginResponse, PluginError } from "../core/protocol";
import { PLUGIN_DEFAULT_TIMEOUT_MS, PLUGIN_HEARTBEAT_INTERVAL_MS, PLUGIN_HEARTBEAT_TIMEOUT_MS, PLUGIN_RECONNECT_INTERVAL_MS, PLUGIN_MAX_RECONNECT_ATTEMPTS } from "../core/protocol";

const WebSocket = require("ws");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
}

export class CodexAdapter extends EventEmitter {
  private ws: any = null;
  private host: string;
  private port: number;
  private connected: boolean = false;
  private autoReconnect: boolean = true;
  private reconnectAttempts: number = 0;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(host: string, port: number) {
    super();
    this.host = host;
    this.port = port;
  }

  public async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.host}:${this.port}`;
      this.ws = new WebSocket(url);
      this.ws.on("open", () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit("connected");
        resolve();
      });
      this.ws.on("message", (data: any) => {
        try { this.handleMessage(JSON.parse(data.toString())); }
        catch (e) { this.emit("error", e); }
      });
      this.ws.on("close", () => {
        this.connected = false;
        this.stopHeartbeat();
        this.emit("disconnected");
        for (const [, p] of this.pendingRequests) { clearTimeout(p.timer); p.reject(new Error("Connection closed")); }
        this.pendingRequests.clear();
        if (this.autoReconnect) this.scheduleReconnect();
      });
      this.ws.on("error", (err: Error) => {
        this.connected = false;
        this.emit("error", err);
        reject(err);
      });
    });
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public disconnect(): void {
    this.autoReconnect = false;
    this.stopHeartbeat();
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false;
  }

  public async call(method: PluginMethod, params: Record<string, unknown>, timeout?: number): Promise<unknown> {
    if (!this.isConnected()) throw new Error("WebSocket not connected");
    return new Promise((resolve, reject) => {
      const id = this.generateId();
      const request: PluginRequest = { type: PluginMessageType.REQUEST, id, method, params, timestamp: Date.now() };
      const timer = setTimeout(() => { this.pendingRequests.delete(id); reject(new Error(`Request timed out: ${method}`)); }, timeout ?? PLUGIN_DEFAULT_TIMEOUT_MS);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(request));
    });
  }

  private handleMessage(message: PluginMessage): void {
    if (message.type === PluginMessageType.RESPONSE) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    } else if (message.type === PluginMessageType.EVENT) {
      this.emit("event", message.event, message.eventData);
    } else if (message.type === PluginMessageType.PONG) {
      // heartbeat response, no action needed
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected()) {
        this.ws.send(JSON.stringify({ type: PluginMessageType.PING, id: this.generateId(), timestamp: Date.now() }));
      }
    }, PLUGIN_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= PLUGIN_MAX_RECONNECT_ATTEMPTS) {
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }
    this.reconnectAttempts++;
    const delay = PLUGIN_RECONNECT_INTERVAL_MS * Math.min(this.reconnectAttempts, 5);
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  private generateId(): string { return `ca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

  // Convenience methods
  public async fileCreate(params: any): Promise<any> { return this.call(PluginMethod.FILE_CREATE, params); }
  public async fileRead(params: any): Promise<any> { return this.call(PluginMethod.FILE_READ, params); }
  public async fileEdit(params: any): Promise<any> { return this.call(PluginMethod.FILE_EDIT, params); }
  public async fileDelete(params: any): Promise<any> { return this.call(PluginMethod.FILE_DELETE, params); }
  public async fileList(params: any): Promise<any> { return this.call(PluginMethod.FILE_LIST, params); }
  public async terminalExec(params: any): Promise<any> { return this.call(PluginMethod.TERMINAL_EXEC, params, 300000); }
}
