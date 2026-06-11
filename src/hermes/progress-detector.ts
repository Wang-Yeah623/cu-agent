/**
 * Cu Agent — 进度检测器
 *
 * 职责：每次子任务执行完毕后，检测项目整体进度，评估偏离情况。
 * 这是 Cu Agent 区别于"一次性生成"类产品的核心差异化能力。
 */

import { HermesClient } from "./client";
import {
  ProgressSnapshot,
  SubTask,
  DeviationLevel,
  generateId,
  now,
} from "../core";
import { PROGRESS_CHECK_MIN_INTERVAL_MS, PROGRESS_WEIGHTS } from "../core/constants";

export interface ProgressInput {
  requirement: string;
  completedTasks: SubTask[];
  allTasks: SubTask[];
  fileTree: string;
  lastActionOutput: string;
  lastActionResult: string;
}

/**
 * 进度检测器
 *
 * 每次子任务完成后调用 check()，返回结构化的进度快照。
 * 检测维度：需求覆盖度、文件产出、可运行性、代码质量、用户反馈
 */
export class ProgressDetector {
  private hermes: HermesClient;
  private systemPrompt: string;
  private lastCheckTime: number = 0;

  constructor(hermes: HermesClient) {
    this.hermes = hermes;
    this.systemPrompt = `你是一个项目进度检测器。请根据以下信息评估项目完成度。

评估维度：
1. 需求覆盖度（权重 40%）：用户需求中的功能点，有多少已经实现？
2. 文件产出（权重 20%）：实际文件结构与预期文件结构匹配吗？
3. 可运行性（权重 25%）：代码能否编译通过？关键的导入和调用是否正确？
4. 代码质量（权重 10%）：代码结构是否合理？命名是否规范？
5. 用户反馈（权重 5%）：如果有用户明确说"可以"、"不错"，加权加分

输出必须是 JSON 格式：
{
  "percentage": 45,
  "deviationLevel": "none",
  "summary": "已完成项目框架搭建...",
  "nextTask": "下一步应该...",
  "needsUserInput": false,
  "userQuestion": ""
}

deviationLevel 取值：none / minor / major / critical
- none: 正常推进
- minor: 有小偏离但不影响整体方向
- major: 明显偏离需求，需要用户确认
- critical: 完全偏离，必须停下来问用户`;
  }

  /**
   * 检测当前进度
   */
  public async check(input: ProgressInput): Promise<ProgressSnapshot> {
    // 限频：最小检测间隔
    const nowMs = Date.now();
    if (nowMs - this.lastCheckTime < PROGRESS_CHECK_MIN_INTERVAL_MS) {
      await this.sleep(PROGRESS_CHECK_MIN_INTERVAL_MS - (nowMs - this.lastCheckTime));
    }
    this.lastCheckTime = Date.now();

    const completed = input.completedTasks.map((t) => `✅ ${t.name} (${t.progressAtCompletion}%)`).join("\n");
    const total = input.allTasks.map((t) => `${t.status === "completed" ? "✅" : "⬜"} ${t.name}`).join("\n");

    // 先做硬计算：基于任务完成度的基础进度
    const taskBasedPercentage = this.calculateTaskBasedProgress(input);

    const userMessage = `
【原始需求】
${input.requirement}

【全部任务】
${total}

【已完成任务】
${completed}

【当前项目文件结构】
${input.fileTree || "(尚未生成文件)"}

【最近的操作】
${input.lastActionOutput}

【操作结果】
${input.lastActionResult}

请评估当前进度。`;

    try {
      const response = await this.hermes.call(this.systemPrompt, userMessage);

      // 尝试从 response 解析 JSON
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
      const parsed = JSON.parse(jsonStr);

      // 混合 Hermes 评估 + 任务基准进度
      const hermesPercentage = parsed.percentage ?? taskBasedPercentage;
      const blendedPercentage = Math.round(
        hermesPercentage * 0.6 + taskBasedPercentage * 0.4
      );

      return {
        id: generateId(),
        projectId: input.allTasks[0]?.projectId ?? "",
        percentage: Math.max(0, Math.min(100, blendedPercentage)),
        completedTaskCount: input.completedTasks.length,
        totalTaskCount: input.allTasks.length,
        fileTree: input.fileTree || "",
        summary: parsed.summary ?? "",
        nextTask: parsed.nextTask ?? "",
        deviationFlag: parsed.deviationLevel !== "none",
        deviationLevel: parsed.deviationLevel ?? DeviationLevel.NONE,
        needsUserInput: parsed.needsUserInput ?? false,
        userQuestion: parsed.userQuestion,
        createdAt: now(),
      };
    } catch {
      // 降级：基于任务完成度的纯硬计算
      return this.createHardcodedSnapshot(input, taskBasedPercentage);
    }
  }

  /**
   * 硬计算：基于任务完成度的基础进度
   */
  private calculateTaskBasedProgress(input: ProgressInput): number {
    if (input.allTasks.length === 0) return 0;

    let totalProgress = 0;
    for (const task of input.completedTasks) {
      totalProgress += task.progressAtCompletion;
    }
    return Math.min(100, Math.round(totalProgress));
  }

  /**
   * 当 Hermes 评估失败时的降级快照
   */
  private createHardcodedSnapshot(
    input: ProgressInput,
    percentage: number
  ): ProgressSnapshot {
    const nextTask = input.allTasks.find((t) => t.status !== "completed");
    return {
      id: generateId(),
      projectId: input.allTasks[0]?.projectId ?? "",
      percentage,
      completedTaskCount: input.completedTasks.length,
      totalTaskCount: input.allTasks.length,
      fileTree: input.fileTree || "",
      summary: `已完成 ${input.completedTasks.length}/${input.allTasks.length} 个子任务`,
      nextTask: nextTask?.name ?? "全部完成",
      deviationFlag: false,
      deviationLevel: DeviationLevel.NONE,
      needsUserInput: false,
      createdAt: now(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
