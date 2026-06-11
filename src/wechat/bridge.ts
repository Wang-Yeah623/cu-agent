/**
 * Cu Agent — WeChat Clawbot 消息桥接器
 *
 * 职责：连接企业微信 Clawbot（机器人）的消息收发。
 * 抽象：消息层独立于具体的 WeChat API 实现，便于测试和迁移。
 */

import { EventEmitter } from "events";
import { WeChatMessage, WeChatOutgoingMessage, generateId, now } from "../core";
import { WECHAT_RETRY_INTERVAL_MS, WECHAT_MAX_RETRIES } from "../core/constants";

export interface ClawbotConfig {
  /** 企业微信机器人的 Webhook URL */
  webhookUrl: string;
  /** 接收消息的 API 端点（用于设置回调） */
  receiveUrl?: string;
  /** 机器人名称（显示用） */
  botName?: string;
  /** 消息签名密钥（用于验证消息来源） */
  secret?: string;
}

export interface MessageEventMap {
  "message:received": [message: WeChatMessage];
  "message:sent": [message: WeChatOutgoingMessage];
  "message:failed": [error: Error, message: WeChatOutgoingMessage];
  "bridge:connected": [];
  "bridge:disconnected": [];
  "bridge:error": [error: Error];
}

/**
 * Clawbot 消息桥接器
 *
 * 功能：
 * 1. 接收微信消息（通过 HTTP 回调）
 * 2. 发送消息到微信（通过 Webhook）
 * 3. 消息重试
 * 4. 消息验证
 */
export class ClawbotBridge extends EventEmitter {
  private config: ClawbotConfig;
  private connected: boolean = false;

  constructor(config: ClawbotConfig) {
    super();
    this.config = config;
  }

  /**
   * 建立连接（验证配置可用性）
   */
  public async connect(): Promise<boolean> {
    try {
      // 发送一个测试 ping 消息来验证 webhook
      const testResult = await this.sendRaw({
        msgtype: "text",
        text: { content: "Cu Agent 已就绪 🤖" },
      });

      this.connected = testResult;
      if (testResult) {
        this.emit("bridge:connected");
      }
      return testResult;
    } catch (error) {
      this.emit(
        "bridge:error",
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  /**
   * 发送消息到微信
   */
  public async send(message: WeChatOutgoingMessage): Promise<boolean> {
    const payload = this.toWebhookPayload(message);
    return this.sendWithRetry(payload, message);
  }

  /**
   * 接收从微信传入的消息（HTTP 回调入口）
   */
  public receive(raw: unknown): WeChatMessage | null {
    try {
      const parsed = this.parseIncoming(raw);
      if (parsed) {
        this.emit("message:received", parsed);
      }
      return parsed;
    } catch (error) {
      this.emit(
        "bridge:error",
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  /**
   * 断开发送连接
   */
  public disconnect(): void {
    this.connected = false;
    this.emit("bridge:disconnected");
  }

  /**
   * 是否已连接
   */
  public get isConnected(): boolean {
    return this.connected;
  }

  /**
   * 发送 Markdown 格式的进度报告
   */
  public async sendProgressReport(
    projectName: string,
    percentage: number,
    completedItems: string[],
    nextSteps: string[],
    warnings?: string[]
  ): Promise<boolean> {
    const lines: string[] = [
      `📊 **Cu Agent 进度报告**`,
      ``,
      `**项目**：${projectName}`,
      `**进度**：${percentage}%`,
      ``,
      `✅ **已完成：**`,
      ...completedItems.map((item) => `· ${item}`),
      ``,
      `🔜 **下一步：**`,
      ...nextSteps.map((step) => `· ${step}`),
    ];

    if (warnings && warnings.length > 0) {
      lines.push(``, `⚠️ **需要注意：**`);
      for (const w of warnings) {
        lines.push(`· ${w}`);
      }
    }

    lines.push(``, `需要我调整方向吗？直接告诉我就行。`);

    return this.send({
      msgType: "markdown",
      content: lines.join("\n"),
    });
  }

  /**
   * 发送简单文本消息
   */
  public async sendText(text: string): Promise<boolean> {
    return this.send({ msgType: "text", content: text });
  }

  private async sendWithRetry(
    payload: Record<string, unknown>,
    originalMessage: WeChatOutgoingMessage,
    attempt: number = 0
  ): Promise<boolean> {
    try {
      const success = await this.sendRaw(payload);
      if (success) {
        this.emit("message:sent", originalMessage);
        return true;
      }
      throw new Error("Webhook returned failure");
    } catch (error) {
      if (attempt < WECHAT_MAX_RETRIES - 1) {
        await this.sleep(WECHAT_RETRY_INTERVAL_MS);
        return this.sendWithRetry(payload, originalMessage, attempt + 1);
      }
      this.emit(
        "message:failed",
        error instanceof Error ? error : new Error(String(error)),
        originalMessage
      );
      return false;
    }
  }

  private async sendRaw(payload: Record<string, unknown>): Promise<boolean> {
    const response = await fetch(this.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  }

  private toWebhookPayload(message: WeChatOutgoingMessage): Record<string, unknown> {
    if (message.msgType === "markdown") {
      return { msgtype: "markdown", markdown: { content: message.content } };
    }
    return { msgtype: "text", text: { content: message.content } };
  }

  private parseIncoming(raw: unknown): WeChatMessage | null {
    const data = raw as Record<string, unknown> | null;
    if (!data) return null;

    // 企业微信机器人回调格式
    if (data.msgtype === "text" || data.text) {
      const textContent = data.text as Record<string, unknown> | undefined;
      return {
        msgId: (data.msgid as string) ?? generateId(),
        fromUser: (data.from_user as string) ?? "unknown",
        content: (textContent?.content as string) ?? "",
        timestamp: now(),
      };
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
