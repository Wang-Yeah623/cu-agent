/**
 * Cu Agent — 微信消息处理器
 *
 * 职责：接收 ClawbotBridge 传来的消息，路由到对应的 Intent 处理器。
 * 策略：一个用户一次只能有一个活跃项目，新消息根据项目状态路由。
 */

import { WeChatMessage, ProjectStatus, UserIntentAction as IntentAction } from "../core";
import { IntentParser } from "../hermes/intent-parser";
import { ExecutionLoop } from "../loop/execution-loop";
import { ClawbotBridge } from "./bridge";

export type MessageHandler = (message: WeChatMessage) => Promise<void>;

/**
 * 微信消息路由器
 *
 * 根据用户当前的活跃项目状态，决定如何处理消息：
 * - 无活跃项目 → 创建新项目
 * - 有活跃项目 → 解析意图并执行对应动作
 */
export class MessageRouter {
  private intentParser: IntentParser;
  private bridge: ClawbotBridge;
  private activeUsers: Map<string, ExecutionLoop> = new Map();

  constructor(intentParser: IntentParser, bridge: ClawbotBridge) {
    this.intentParser = intentParser;
    this.bridge = bridge;
  }

  /**
   * 处理传入的微信消息
   */
  public async handleMessage(message: WeChatMessage): Promise<void> {
    const userLoop = this.activeUsers.get(message.fromUser);

    // 新用户或用户没有活跃项目
    if (!userLoop) {
      // 消息应该以 CREATE_PROJECT 意图开始
      const intent = await this.intentParser.parse(message);

      if (intent.action === IntentAction.CREATE_PROJECT) {
        await this.bridge.send({
          msgType: "text",
          content: `收到需求，正在分析：「${message.content}」\n请稍等，我先拆解任务...`,
        });
        // 执行循环器会通过外部接口创建项目
        // 这里只通知外部：有新项目请求
        this.emit("project:request", message);
      } else {
        await this.bridge.send({
          msgType: "text",
          content:
            "你好！我是 Cu Agent 🤖\n\n你可以发一个编程需求给我，比如：\n" +
            "· 「帮我做一个个人博客」\n· 「帮我写一个待办事项App」\n· 「帮我做个API接口」",
        });
      }
      return;
    }

    // 用户已有活跃项目
    const intent = await this.intentParser.parse(message);

    switch (intent.action) {
      case IntentAction.PAUSE:
        userLoop.pause();
        await this.bridge.sendText("⏸️ 已暂停。发「继续」恢复。");
        break;

      case IntentAction.RESUME:
        userLoop.resume();
        await this.bridge.sendText("▶️ 继续执行中...");
        break;

      case IntentAction.REPORT_PROGRESS:
        const snapshot = userLoop.getCurrentProgress();
        if (snapshot) {
          await this.bridge.sendProgressReport(
            "当前项目",
            snapshot.percentage,
            [`已完成 ${snapshot.completedTaskCount}/${snapshot.totalTaskCount} 个任务`],
            [snapshot.nextTask],
            snapshot.deviationFlag ? ["检测到偏离，正在自动修正"] : undefined
          );
        } else {
          await this.bridge.sendText("项目正在准备中...");
        }
        break;

      case IntentAction.STOP:
        userLoop.stop();
        this.activeUsers.delete(message.fromUser);
        await this.bridge.sendText("🛑 项目已停止。有新需求随时找我。");
        break;

      case IntentAction.APPROVE:
        userLoop.approvePendingRequest();
        await this.bridge.sendText("✅ 已确认，继续执行。");
        break;

      case IntentAction.SELECT_OPTION:
        userLoop.submitUserChoice(intent.value ?? "");
        await this.bridge.sendText(`已收到选择：${intent.value}`);
        break;

      case IntentAction.MODIFY_PLAN:
        userLoop.handleUserFeedback(message.content);
        await this.bridge.sendText(
          `🔄 收到纠偏指令，正在重新规划...\n「${message.content}」`
        );
        break;

      case IntentAction.CREATE_PROJECT:
        await this.bridge.sendText(
          "⚠️ 你已有一个进行中的项目。先发「停」结束当前项目，再发新需求。"
        );
        break;

      case IntentAction.UNKNOWN:
      default:
        await this.bridge.sendText(
          "🤔 我没理解你的意思。你可以：\n" +
          "· 发「进度」查看当前状态\n" +
          "· 发「停」暂停\n" +
          "· 发「继续」恢复\n" +
          "· 或者直接告诉我需要改什么"
        );
        break;
    }
  }

  /**
   * 注册一个用户的执行循环（当项目被创建后调用）
   */
  public registerUser(userId: string, loop: ExecutionLoop): void {
    this.activeUsers.set(userId, loop);
  }

  /**
   * 注销用户
   */
  public unregisterUser(userId: string): void {
    this.activeUsers.delete(userId);
  }

  /**
   * 检查用户是否有活跃项目
   */
  public hasActiveProject(userId: string): boolean {
    return this.activeUsers.has(userId);
  }

  // 简单的观察者模式（避免循环依赖）
  private handlers: Map<string, Function[]> = new Map();

  private emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  public on(event: string, handler: Function): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }
}
