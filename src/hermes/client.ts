/**
 * Cu Agent — Hermes 模型客户端
 *
 * 职责：封装对 Hermes 模型（Nous Research）的 API 调用。
 * 支持：函数调用（Function Calling）、结构化输出。
 *
 * 设计说明：
 * - 以接口抽象，便于切换不同部署方式（本地模型 / API 代理 / 云端）
 * - 所有通信走结构化 JSON，防止模型输出格式漂移
 */

import { TechStack, UserIntent, UserIntentAction, DeviationLevel } from "../core";

/* ===== 配置 ===== */

export interface HermesConfig {
  /** API 端点（本地或代理） */
  apiEndpoint: string;
  /** API Key（如有） */
  apiKey?: string;
  /** 模型名称 */
  modelName?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
}

/* ===== 消息结构 ===== */

export interface HermesMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: HermesToolCall[];
  toolCallId?: string;
}

export interface HermesToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface HermesToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface HermesResponse {
  content: string;
  toolCalls: HermesToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/* ===== Hermes 客户端 ===== */

export class HermesClient {
  private config: HermesConfig;

  constructor(config: HermesConfig) {
    this.config = {
      modelName: "hermes-3-llama-3.1-8b",
      maxTokens: 4096,
      temperature: 0.3,
      ...config,
    };
  }

  /**
   * 发送对话请求，返回模型响应
   */
  public async chat(
    messages: HermesMessage[],
    tools?: HermesToolDefinition[]
  ): Promise<HermesResponse> {
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body["tools"] = tools;
    }

    try {
      const response = await fetch(`${this.config.apiEndpoint}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Hermes API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      throw new Error(
        `Hermes request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 简化的单轮调用（用于明确结构的查询）
   */
  public async call(
    systemPrompt: string,
    userMessage: string,
    tools?: HermesToolDefinition[]
  ): Promise<HermesResponse> {
    const messages: HermesMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];
    return this.chat(messages, tools);
  }

  private parseResponse(data: unknown): HermesResponse {
    const choice = (data as any)?.choices?.[0];
    if (!choice) {
      throw new Error(`Unexpected Hermes response format: ${JSON.stringify(data)}`);
    }

    const message = choice.message;
    return {
      content: message?.content ?? "",
      toolCalls: message?.tool_calls ?? [],
      finishReason: choice.finish_reason ?? "stop",
      usage: (data as any)?.usage
        ? {
            promptTokens: (data as any).usage.prompt_tokens,
            completionTokens: (data as any).usage.completion_tokens,
            totalTokens: (data as any).usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * 获取工具定义（供外部组装用）
   */
  public static getCommonTools(): HermesToolDefinition[] {
    return [
      {
        type: "function",
        function: {
          name: "parse_intent",
          description: "解析用户自然语言意图",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: Object.values(UserIntentAction),
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              target: { type: "string" },
              value: { type: "string" },
            },
            required: ["action", "confidence"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "detect_progress",
          description: "基于已完成任务和文件结构检测当前进度",
          parameters: {
            type: "object",
            properties: {
              percentage: { type: "number", minimum: 0, maximum: 100 },
              deviationLevel: {
                type: "string",
                enum: Object.values(DeviationLevel),
              },
              summary: { type: "string" },
              nextTask: { type: "string" },
              needsUserInput: { type: "boolean" },
              userQuestion: { type: "string" },
            },
            required: ["percentage", "deviationLevel", "summary", "nextTask", "needsUserInput"],
          },
        },
      },
    ];
  }
}
