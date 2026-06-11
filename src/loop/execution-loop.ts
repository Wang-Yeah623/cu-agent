/**
 * Cu Agent - Execution Loop
 * Core loop: execute task -> check progress -> plan next -> continue.
 * Design: human-in-the-loop, progress check every cycle, user can interject anytime via WeChat.
 */
import { EventEmitter } from "events";
import { Project, SubTask, ProgressSnapshot, Action,
  ActionType, TaskStatus, ProjectStatus,
  generateId, now,
} from "../core";
import { HermesClient, TaskPlanner, ProgressDetector } from "../hermes";
import { SecurityGate } from "../registry";
import { CodexAdapter, TerminalAdapter, FileSystemAdapter } from "../executor";
import { TASK_EXECUTION_TIMEOUT_MS, USER_INPUT_TIMEOUT_MS } from "../core/constants";
import { PluginMethod } from "../core/protocol";
import { StateMachine } from "./state-machine";
import * as path from "path";

export class ExecutionLoop extends EventEmitter {
  private project!: Project;
  private tasks: SubTask[] = [];
  private completedTasks: SubTask[] = [];
  private currentTaskIndex: number = -1;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private projectCreated: boolean = false;
  private latestSnapshot: ProgressSnapshot | undefined;
  private readonly sm = new StateMachine();
  private lastActionOutput: string = "";
  private lastActionResult: string = "";

  private hermes: HermesClient;
  private taskPlanner: TaskPlanner;
  private progressDetector: ProgressDetector;
  private codex: CodexAdapter;
  private terminal: TerminalAdapter;
  private fileSystem: FileSystemAdapter;
  private securityGate: SecurityGate;

  constructor(
    hermesClient: HermesClient,
    taskPlanner: TaskPlanner,
    progressDetector: ProgressDetector,
    codexAdapter: CodexAdapter,
    terminalAdapter: TerminalAdapter,
    fileSystemAdapter: FileSystemAdapter,
    securityGate: SecurityGate
  ) {
    super();
    this.hermes = hermesClient;
    this.taskPlanner = taskPlanner;
    this.progressDetector = progressDetector;
    this.codex = codexAdapter;
    this.terminal = terminalAdapter;
    this.fileSystem = fileSystemAdapter;
    this.securityGate = securityGate;
  }

  public async createProject(requirement: string, outputDir: string): Promise<Project> {
    this.project = {
      id: generateId(),
      name: requirement.slice(0, 40).replace(/[\u5E2E\u6211\u505A]/g, "").trim() || "NewProject",
      requirement,
      requirementSummary: "",
      techStack: {},
      outputDir,
      status: ProjectStatus.IDLE,
      createdAt: now(),
      updatedAt: now(),
    };
    this.sm.reset();
    this.lastActionOutput = "";
    this.lastActionResult = "";
    this.projectCreated = true;
    return this.project;
  }

  public async start(): Promise<void> {
    if (!this.projectCreated) throw new Error("Project not created yet");
    if (this.isRunning) throw new Error("Already running");
    this.isRunning = true;
    this.isPaused = false;
    this.setStatus(ProjectStatus.PLANNING);

    try {
      this.emit("log", { level: "info", message: "Planning tasks..." });
      const plan = await this.taskPlanner.plan(this.project.requirement);
      this.tasks = plan.tasks.map(t => ({ ...t, projectId: this.project.id }));
      this.setStatus(ProjectStatus.EXECUTING);
      this.emit("log", { level: "info", message: `Plan done: ${this.tasks.length} tasks` });
      await this.executionLoop();
    } catch (error) {
      this.setStatus(ProjectStatus.FAILED);
      this.emit("loop:error", error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isRunning = false;
    }
  }

  public pause(): void {
    this.isPaused = true;
    this.setStatus(ProjectStatus.PAUSED);
    this.emit("loop:pause");
  }

  public resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.setStatus(ProjectStatus.EXECUTING);
    this.emit("loop:resume");
  }

  public stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.setStatus(ProjectStatus.IDLE);
  }

  public approvePendingRequest(): void {
    const pending = this.securityGate.getPendingApprovals();
    if (pending.length > 0) {
      this.securityGate.resolveApproval(pending[0].id, true);
      this.setStatus(ProjectStatus.EXECUTING);
    }
  }

  public submitUserChoice(choice: string): void {
    this.emit("log", { level: "info", message: `User chose: ${choice}` });
    this.setStatus(ProjectStatus.EXECUTING);
  }

  public async handleUserFeedback(feedback: string): Promise<void> {
    await this.replanTasks(feedback);
    this.setStatus(ProjectStatus.EXECUTING);
  }

  public getCurrentProgress(): ProgressSnapshot | undefined {
    return this.latestSnapshot;
  }

  public getProject(): Project | undefined {
    return this.projectCreated ? this.project : undefined;
  }

  public getState(): any {
    return { project: this.project, tasks: this.tasks, completedTasks: this.completedTasks,
      currentTaskIndex: this.currentTaskIndex, isRunning: this.isRunning, isPaused: this.isPaused };
  }

  /** 是否有一个正在进行（未结束）的项目 */
  public isActive(): boolean {
    return this.projectCreated &&
      this.project.status !== ProjectStatus.IDLE &&
      this.project.status !== ProjectStatus.COMPLETED &&
      this.project.status !== ProjectStatus.FAILED;
  }

  /**
   * 通过状态机切换项目状态：合法转换走状态机校验；
   * 非常规转换记一条 warn 日志后强制同步（容错，绝不阻断主流程）。
   */
  private setStatus(to: ProjectStatus, reason?: string): void {
    if (this.sm.state !== to) {
      try {
        this.sm.transitionTo(to, reason);
      } catch (e) {
        this.emit("log", { level: "warn", message: `状态切换 ${this.sm.state} → ${to} 非常规：${(e as Error).message}` });
        this.sm.force(to, reason);
      }
    }
    this.project.status = this.sm.state;
  }

  // ===== Internal: Execution Loop =====

  private async executionLoop(): Promise<void> {
    while (this.isRunning && this.currentTaskIndex < this.tasks.length - 1) {
      if (this.isPaused) await this.waitWhilePausedOrWaiting();
      if (!this.isRunning) break;
      this.currentTaskIndex++;
      if (this.tasks[this.currentTaskIndex].status === TaskStatus.COMPLETED) continue;

      const task = this.tasks[this.currentTaskIndex];
      // executeTask 内部已做一次进度检测，复用其返回的快照（避免每个任务重复 LLM 调用）
      const snapshot = await this.executeTask(task);
      if (!this.isRunning) break;

      if (snapshot && snapshot.deviationFlag && snapshot.deviationLevel !== "none") {
        this.emit("user:question", `Deviation detected: ${snapshot.summary}. Adjust direction?`);
        this.setStatus(ProjectStatus.WAITING_USER_INPUT);
        await this.waitWhilePausedOrWaiting();
        if (!this.isRunning) break;
        this.setStatus(ProjectStatus.EXECUTING);
      }
    }
    if (this.isRunning && this.currentTaskIndex >= this.tasks.length - 1) {
      this.setStatus(ProjectStatus.COMPLETED);
      this.emit("loop:complete", this.project);
    }
  }

  private async executeTask(task: SubTask): Promise<ProgressSnapshot | undefined> {
    task.status = TaskStatus.EXECUTING;
    this.emit("task:start", task);
    this.emit("log", { level: "info", message: `Executing: ${task.name}` });

    try {
      const actions = await this.planActions(task);
      for (const action of actions) {
        if (!this.isRunning) return undefined;
        if (this.isPaused) await this.waitWhilePausedOrWaiting();
        await this.executeAction(action, task);
      }
      if (!this.isRunning) return undefined;
      task.status = TaskStatus.COMPLETED;
      this.completedTasks.push(task);
      const snap = await this.checkProgress();
      this.emit("task:complete", task, snap);
      return snap;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      const msg = error instanceof Error ? error.message : String(error);
      this.emit("task:fail", task, msg);
      this.emit("log", { level: "error", message: `Task failed: ${task.name} - ${msg}` });
      return undefined;
    }
  }

  private async planActions(task: SubTask): Promise<Action[]> {
    const systemPrompt = `You are a coding assistant. Generate file operations and terminal commands for the task.
Output format must be a JSON array:
[{ "type": "file.create" | "file.edit" | "terminal.exec", "payload": { "path": "...", "content": "...", "command": "..." } }]
Project root: ${this.project.outputDir}`;

    const userMessage = `Task: ${task.name}\nDescription: ${task.description}\nTech: ${JSON.stringify(this.project.techStack)}`;

    try {
      const response = await this.hermes.call(systemPrompt, userMessage);
      const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
      const parsed = JSON.parse(jsonStr.trim());
      const actions: Action[] = Array.isArray(parsed) ? parsed : (parsed.actions ?? []);
      return actions.map((a: any) => ({
        id: generateId(), subTaskId: task.id,
        type: this.normalizeActionType(a.type),
        payload: a.payload ?? {}, timestamp: now(),
      }));
    } catch {
      return [{ id: generateId(), subTaskId: task.id, type: ActionType.TERMINAL_EXEC,
        payload: { command: `echo "Task: ${task.name}"`, cwd: this.project.outputDir }, timestamp: now() }];
    }
  }

  private normalizeActionType(type: string): ActionType {
    const t = type.toLowerCase().trim();
    if (t.includes("create")) return ActionType.FILE_CREATE;
    if (t.includes("edit")) return ActionType.FILE_EDIT;
    if (t.includes("delete")) return ActionType.FILE_DELETE;
    if (t.includes("terminal") || t.includes("exec") || t.includes("command") || t.includes("run"))
      return ActionType.TERMINAL_EXEC;
    if (t.includes("generate") || t.includes("code")) return ActionType.CODE_GENERATE;
    return ActionType.TERMINAL_EXEC;
  }

  private async executeAction(action: Action, task: SubTask): Promise<void> {
    const check = this.securityGate.checkAction(action.type, action.payload);
    if (check.requiresApproval) {
      const approval = this.securityGate.createApprovalRequest(
        this.project.id, `${action.type}: ${JSON.stringify(action.payload).slice(0, 100)}`,
        action.type, action.payload, check.reason ?? "approval needed"
      );
      this.emit("user:approval", approval.id, approval.description);
      this.setStatus(ProjectStatus.WAITING_APPROVAL);
      await this.waitWhilePausedOrWaiting();
      if (!this.isRunning || approval.status === "rejected") return;
    }

    try {
      const codexConnected = this.codex.isConnected();
      switch (action.type) {
        case ActionType.FILE_CREATE: {
          const rawPath = String(action.payload["path"] ?? "");
          const content = String(action.payload["content"] ?? "");
          if (!rawPath) throw new Error("file.create: path is required");
          const filePath = this.resolveAndCheckPath(rawPath);
          if (codexConnected) {
            await this.codex.call(PluginMethod.FILE_CREATE, { path: filePath, content, overwrite: true });
          } else {
            const result = await this.fileSystem.createFile(filePath, content, true);
            this.lastActionOutput = `Created ${result.path} (${result.size}B)`;
            this.lastActionResult = "ok";
            this.emit("log", { level: "info", message: `Created: ${result.path} (${result.size}B)` });
          }
          break;
        }
        case ActionType.FILE_EDIT: {
          const rawPath = String(action.payload["path"] ?? "");
          const oldText = String(action.payload["oldText"] ?? "");
          const newText = String(action.payload["newText"] ?? "");
          if (!rawPath) throw new Error("file.edit: path is required");
          const filePath = this.resolveAndCheckPath(rawPath);
          if (codexConnected) {
            await this.codex.call(PluginMethod.FILE_EDIT, { path: filePath, oldText, newText });
          } else {
            const result = await this.fileSystem.editFile(filePath, oldText, newText);
            this.lastActionOutput = `Edited ${result.path}`;
            this.lastActionResult = "ok";
            this.emit("log", { level: "info", message: `Edited: ${result.path}` });
          }
          break;
        }
        case ActionType.TERMINAL_EXEC: {
          const command = String(action.payload["command"] ?? "");
          if (!command) throw new Error("terminal.exec: command is required");
          const cwd = this.resolveAndCheckPath(String(action.payload["cwd"] ?? this.project.outputDir));
          if (codexConnected) {
            await this.codex.call(PluginMethod.TERMINAL_EXEC, { command, cwd });
          } else {
            const result = await this.terminal.exec(command, { cwd });
            const output = (result.output || "").slice(0, 300);
            this.lastActionOutput = (result.output || result.error || "").slice(0, 1000);
            this.lastActionResult = `exit=${result.exitCode}${result.success ? "" : " (failed)"}`;
            this.emit("log", { level: result.success ? "info" : "warn",
              message: `Cmd: ${command.slice(0, 80)} [exit=${result.exitCode}] ${output}` });
          }
          break;
        }
        default:
          this.emit("log", { level: "warn", message: `Unhandled: ${action.type}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emit("log", { level: "error", message: `Action failed: ${action.type} - ${msg}` });
      throw error;
    }
    action.timestamp = now();
    task.actions.push(action);
  }

  private async checkProgress(): Promise<ProgressSnapshot> {
    const fileTree = await this.fileSystem.getFileTree(this.project.outputDir);
    const snapshot = await this.progressDetector.check({
      requirement: this.project.requirement,
      completedTasks: this.completedTasks,
      allTasks: this.tasks,
      fileTree, lastActionOutput: this.lastActionOutput, lastActionResult: this.lastActionResult,
    });
    this.emit("progress:update", snapshot);
    this.latestSnapshot = snapshot;
    return snapshot;
  }

  private async replanTasks(userFeedback: string): Promise<void> {
    this.emit("log", { level: "info", message: "Replanning remaining tasks..." });
    const newPlan = await this.taskPlanner.replan(this.project, this.completedTasks, userFeedback);
    const remainingStartIndex = this.currentTaskIndex + 1;
    const remainingTasks = newPlan.tasks.map(t => ({ ...t, projectId: this.project.id }));
    this.tasks = [...this.tasks.slice(0, remainingStartIndex), ...remainingTasks];
    this.currentTaskIndex = remainingStartIndex - 1;
    this.emit("log", { level: "info", message: `Replan done: ${remainingTasks.length} remaining tasks` });
  }

  /**
   * 把 LLM 给出的路径解析为绝对路径并做沙箱校验。
   * 相对路径相对项目 outputDir 解析；越界则抛错（拦截执行）。
   */
  private resolveAndCheckPath(rawPath: string): string {
    const abs = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(this.project.outputDir, rawPath);
    const check = this.securityGate.checkFilePath(abs);
    if (!check.allowed) {
      throw new Error(`沙箱拦截：路径越界 ${abs}${check.reason ? "（" + check.reason + "）" : ""}`);
    }
    return abs;
  }

  private waitWhilePausedOrWaiting(timeoutMs: number = USER_INPUT_TIMEOUT_MS): Promise<void> {
    return new Promise(resolve => {
      const start = Date.now();
      const check = setInterval(() => {
        const blocked = this.isPaused ||
          this.project.status === ProjectStatus.WAITING_APPROVAL ||
          this.project.status === ProjectStatus.WAITING_USER_INPUT;
        if (!blocked) { clearInterval(check); resolve(); return; }
        if (Date.now() - start >= timeoutMs) {
          clearInterval(check);
          this.emit("log", {
            level: "warn",
            message: `等待用户响应超过 ${Math.round(timeoutMs / 60000)} 分钟，已自动停止当前项目。重新发需求可再次开始。`,
          });
          // 安全默认：超时即拒绝所有待审批操作，绝不放行未确认的动作
          for (const p of this.securityGate.getPendingApprovals()) {
            this.securityGate.resolveApproval(p.id, false);
          }
          this.isRunning = false;
          this.setStatus(ProjectStatus.PAUSED);
          resolve();
        }
      }, 500);
    });
  }
}
