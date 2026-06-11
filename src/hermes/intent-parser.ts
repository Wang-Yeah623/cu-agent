/**
 * Cu Agent — 意图解析器
 */
import { UserIntent, UserIntentAction, WeChatMessage } from "../core";
import { HermesClient, HermesToolDefinition } from "./client";
import { INTENT_PARSER_PROMPT } from "../core/prompts";

export class IntentParser {
  private hermes: HermesClient;
  private systemPrompt: string;

  constructor(hermes: HermesClient) {
    this.hermes = hermes;
    this.systemPrompt = INTENT_PARSER_PROMPT + `

注意事项：
- 短消息（1-3个字）优先匹配 APPROVE / PAUSE / RESUME
- 包含"帮"、"做"、"创建"等词 → CREATE_PROJECT
- 包含"改"、"换"、"用"、"不要"等词 → MODIFY_PLAN
- 包含"进度"、"到哪"、"多少" → REPORT_PROGRESS
- 纯数字 + 字母/选项名 → SELECT_OPTION`;
  }

  public async parse(message: WeChatMessage): Promise<UserIntent> {
    const tools: HermesToolDefinition[] = [{
      type: "function",
      function: {
        name: "parse_intent",
        description: "解析用户自然语言意图",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: Object.values(UserIntentAction) },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            target: { type: "string" },
            value: { type: "string" },
          },
          required: ["action", "confidence"],
        },
      },
    }];

    const response = await this.hermes.call(this.systemPrompt, message.content, tools);
    if (response.toolCalls?.length) {
      for (const tc of response.toolCalls) {
        if (tc.function.name === "parse_intent") {
          try {
            const args = JSON.parse(tc.function.arguments);
            return { action: args.action, confidence: args.confidence ?? 0.5, target: args.target, value: args.value, rawText: message.content };
          } catch {}
        }
      }
    }
    return this.fallbackParse(message.content);
  }

  private fallbackParse(text: string): UserIntent {
    const t = text.trim().toLowerCase();
    if (/^(可以|好|行|嗯|对|是|ok|yes|y)$/i.test(t))
      return { action: UserIntentAction.APPROVE, confidence: 0.8, rawText: text };
    if (/^(停|暂停|停止|别做了|先别)$/i.test(t))
      return { action: UserIntentAction.PAUSE, confidence: 0.9, rawText: text };
    if (/^(继续|接着做|往下做|resume)$/i.test(t))
      return { action: UserIntentAction.RESUME, confidence: 0.9, rawText: text };
    if (/(进度|到哪了|怎么样了|多少了|做完|还差)/i.test(t))
      return { action: UserIntentAction.REPORT_PROGRESS, confidence: 0.8, rawText: text };
    if (/(取消|不要了|算了|放弃|删除项目)/i.test(t))
      return { action: UserIntentAction.STOP, confidence: 0.7, rawText: text };
    if (/(改|换|用|不要|换成|改为|改用|不要用)/i.test(t))
      return { action: UserIntentAction.MODIFY_PLAN, confidence: 0.6, target: "unknown", value: t, rawText: text };
    if (/^(方案|选|第).{0,4}$/i.test(t) || /^[abcABC][)）.]?$/.test(t))
      return { action: UserIntentAction.SELECT_OPTION, confidence: 0.7, value: t, rawText: text };
    if (/(帮我|做|创建|写|弄|搭|搞)/i.test(t) || t.length > 10)
      return { action: UserIntentAction.CREATE_PROJECT, confidence: 0.5, rawText: text };
    return { action: UserIntentAction.UNKNOWN, confidence: 0.3, rawText: text };
  }
}
