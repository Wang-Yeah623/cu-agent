/**
 * Cu Agent — 任务规划器
 *
 * 职责：将用户需求拆解为有序的子任务列表。
 * 输入：用户原始需求 + 技术栈偏好（可选）
 * 输出：结构化子任务列表 + 技术栈建议
 */

import { HermesClient } from "./client";
import { Project, SubTask, TechStack, TaskStatus, generateId } from "../core";
import { TASK_EXECUTION_TIMEOUT_MS } from "../core/constants";

export interface TaskPlan {
  tasks: SubTask[];
  techStack: TechStack;
  summary: string;
}

/**
 * 任务规划器
 *
 * 通过 Hermes 模型将需求拆解为可执行的子任务序列。
 * 每个子任务遵循「单一职责」原则——一个任务只做一件事。
 */
export class TaskPlanner {
  private hermes: HermesClient;
  private systemPrompt: string;

  constructor(hermes: HermesClient) {
    this.hermes = hermes;
    this.systemPrompt = `你是一个软件项目任务规划器。请将用户的需求拆解为一系列有序的、可执行的子任务。

规则：
1. 每个子任务必须是可执行的单一操作（如"创建项目结构"、"编写首页组件"）
2. 子任务按依赖顺序排列（前置任务在前）
3. 每个子任务需要标注预估的完成度贡献值（0-100，所有任务之和≈100）
4. 根据需求推断技术栈
5. 输出必须是 JSON 格式

输出格式：
{
  "tasks": [
    {
      "name": "任务名称",
      "description": "任务描述",
      "order": 0,
      "progressWeight": 10,
      "dependsOn": []
    }
  ],
  "techStack": {
    "framework": "Next.js",
    "language": "TypeScript",
    "styling": "Tailwind CSS",
    "database": "SQLite",
    "orm": "Prisma"
  },
  "summary": "项目概要说明"
}

注意事项：
- 一个项目通常包含 5-15 个子任务
- 不要省略技术栈推断，如果没有明确信息，使用最常用的技术栈
- 任务顺序从 0 开始
- dependsOn 引用之前任务的 name`;
  }

  /**
   * 根据需求生成任务计划
   */
  public async plan(
    requirement: string,
    preferredTechStack?: Partial<TechStack>
  ): Promise<TaskPlan> {
    const userMessage = preferredTechStack
      ? `需求：${requirement}\n\n技术栈偏好：${JSON.stringify(preferredTechStack)}`
      : `需求：${requirement}`;

    const response = await this.hermes.call(this.systemPrompt, userMessage);

    try {
      // 尝试从 content 提取 JSON
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
      const parsed = JSON.parse(jsonStr);

      return this.normalizePlan(parsed, requirement);
    } catch {
      // 如果 JSON 解析失败，返回一个基础的计划
      return this.createFallbackPlan(requirement);
    }
  }

  /**
   * 将原始解析结果规范化为 TaskPlan
   */
  private normalizePlan(raw: any, requirement: string): TaskPlan {
    const tasks: SubTask[] = (raw.tasks ?? []).map((t: any, i: number) => ({
      id: generateId(),
      projectId: "", // 由调用方填充
      name: t.name ?? `任务 ${i + 1}`,
      description: t.description ?? "",
      status: i === 0 ? TaskStatus.PENDING : TaskStatus.PENDING,
      order: t.order ?? i,
      dependsOn: t.dependsOn ?? [],
      actions: [],
      progressAtCompletion: t.progressWeight ?? Math.round(100 / (raw.tasks?.length ?? 1)),
    }));

    // 确保 progress 总和 = 100
    const totalProgress = tasks.reduce((sum, t) => sum + t.progressAtCompletion, 0);
    if (totalProgress !== 100 && tasks.length > 0) {
      const diff = 100 - totalProgress;
      tasks[tasks.length - 1].progressAtCompletion += diff;
    }

    return {
      tasks,
      techStack: {
        framework: raw.techStack?.framework ?? "Next.js",
        language: raw.techStack?.language ?? "TypeScript",
        styling: raw.techStack?.styling,
        database: raw.techStack?.database,
        orm: raw.techStack?.orm,
      },
      summary: raw.summary ?? requirement,
    };
  }

  /**
   * 当 Hermes 无法正确解析时的降级方案
   */
  private createFallbackPlan(requirement: string): TaskPlan {
    const tasks: SubTask[] = [
      {
        id: generateId(),
        projectId: "",
        name: "项目初始化",
        description: `初始化项目结构：${requirement}`,
        status: TaskStatus.PENDING,
        order: 0,
        dependsOn: [],
        actions: [],
        progressAtCompletion: 15,
      },
      {
        id: generateId(),
        projectId: "",
        name: "核心功能开发",
        description: `实现核心功能模块`,
        status: TaskStatus.PENDING,
        order: 1,
        dependsOn: ["项目初始化"],
        actions: [],
        progressAtCompletion: 50,
      },
      {
        id: generateId(),
        projectId: "",
        name: "UI 开发",
        description: `开发用户界面`,
        status: TaskStatus.PENDING,
        order: 2,
        dependsOn: ["核心功能开发"],
        actions: [],
        progressAtCompletion: 20,
      },
      {
        id: generateId(),
        projectId: "",
        name: "集成与测试",
        description: `集成各组件并进行测试`,
        status: TaskStatus.PENDING,
        order: 3,
        dependsOn: ["核心功能开发", "UI 开发"],
        actions: [],
        progressAtCompletion: 15,
      },
    ];

    return {
      tasks,
      techStack: { framework: "Next.js", language: "TypeScript" },
      summary: requirement,
    };
  }

  /**
   * 根据用户纠偏指令重新规划剩余任务
   */
  public async replan(
    project: Project,
    completedTasks: SubTask[],
    userFeedback: string
  ): Promise<TaskPlan> {
    const completedNames = completedTasks.map((t) => t.name).join(", ");
    const prompt = `
原始需求：${project.requirement}
已完成的任务：${completedNames}
用户的新指令：${userFeedback}

请根据用户的新指令，重新规划剩余的子任务。
只规划尚未完成的部分。`;

    return this.plan(prompt, project.techStack);
  }
}
