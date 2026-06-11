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
import { TASK_EXECUTION_TIMEOUT_MS } from "../core/constants";

export class ExecutionLoop extends EventEmitter {
  private project!: Project;
  private tasks: SubTask[] = [];
  private completedTasks: SubTask[] = [];
  private currentTaskIndex: number = -1;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private projectCreated: boolean = false;
  private latestSnapshot: ProgressSnapshot | undefined;

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
    this.projectCreated = true;
    return this.project;
  }

  public async start(): Promise<void> {
    if (!this.projectCreated) throw new Error("Project not created yet");
    if (this.isRunning) throw new Error("Already running");
    this.isRunning = true;
    this.isPaused = false;
    this.project.status = ProjectStatus.PLANNING;

    try {
      this.emit("log", { level: "info", message: "Planning tasks..." });
      const plan = await this.taskPlanner.plan(this.project.requirement);
      this.tasks = plan.tasks.map(t => ({ ...t, projectId: this.project.id }));
      this.project.status = ProjectStatus.EXECUTING;
      this.emit("log", { level: "info", message: `Plan done: ${this.tasks.length} tasks` });
      await this.executionLoop();
    } catch (error) {
      this.project.status = ProjectStatus.FAILED;
      this.emit("loop:error", error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isRunning = false;
    }
  }

  public pause(): void {
    this.isPaused = true;
    this.project.status = ProjectStatus.PAUSED;
    this.emit("loop:pause");
  }

  public resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.project.status = ProjectStatus.EXECUTING;
    this.emit("loop:resume");
  }

  public stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.project.status = ProjectStatus.IDLE;
  }

  public approvePendingRequest(): void {
    const pending = this.securityGate.getPendingApprovals();
    if (pending.length > 0) {
      this.securityGate.resolveApproval(pending[0].id, true);
      this.project.status = ProjectStatus.EXECUTING;
    }
  }

  public submitUserChoice(choice: string): void {
    this.emit("log", { level: "info", message: `User chose: ${choice}` });
    this.project.status = ProjectStatus.EXECUTING;
  }

  public async handleUserFeedback(feedback: string): Promise<void> {
    await this.replanTasks(feedback);
    this.project.status = ProjectStatus.EXECUTING;
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

  // ===== Internal: Execution Loop =====

  private async executionLoop(): Promise<void> {
    while (this.isRunning && this.currentTaskIndex < this.tasks.length - 1) {
      if (this.isPaused) await this.waitWhilePausedOrWaiting();
      this.currentTaskIndex++;
      if (this.tasks[this.currentTaskIndex].status === TaskStatus.COMPLETED) continue;

      const task = this.tasks[this.currentTaskIndex];
      await this.executeTask(task);

      const snapshot = await this.checkProgress();
      if (snapshot.deviationFlag && snapshot.deviationLevel !== "none") {
        this.emit("user:question", `Deviation detected: ${snapshot.summary}. Adjust direction?`);
        this.project.status = ProjectStatus.WAITING_USER_INPUT;
        await this.waitWhilePausedOrWaiting();
        this.project.status = ProjectStatus.EXECUTING;
      }
    }
    if (this.currentTaskIndex >= this.tasks.length - 1) {
      this.project.status = ProjectStatus.COMPLETED;
      this.emit("loop:complete", this.project);
    }
  }

  private async executeTask(task: SubTask): Promise<void> {
    task.status = TaskStatus.EXECUTING;
    this.emit("task:start", task);
    this.emit("log", { level: "info", message: `Executing: ${task.name}` });

    try {
      const actions = await this.planActions(task);
      for (const action of actions) {
        if (this.isPaused) await this.waitWhilePausedOrWaiting();
        await this.executeAction(action, task);
      }
      task.status = TaskStatus.COMPLETED;
      this.completedTasks.push(task);
      const snap = await this.checkProgress();
      this.emit("task:complete", task, snap);
    } catch (error) {
      task.status = TaskStatus.FAILED;
      const msg = error instanceof Error ? error.message : String(error);
      this.emit("task:fail", task, msg);
      this.emit("log", { level: "error", message: `Task failed: ${task.name} - ${msg}` });
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
      this.project.status = ProjectStatus.WAITING_APPROVAL;
      await this.waitWhilePausedOrWaiting();
      if (approval.status === "rejected") return;
    }

    try {
      const codexConnected = this.codex.isConnected();
      switch (action.type) {
        case ActionType.FILE_CREATE: {
          const path = String(action.payload["path"] ?? "");
          const content = String(action.payload["content"] ?? "");
          if (!path) throw new Error("file.create: path is required");
          if (codexConnected) {
            await this.codex.call("file.create", { path, content, overwrite: true });
          } else {
            const result = await this.fileSystem.createFile(path, content, true);
            this.emit("log", { level: "info", message: `Created: ${result.path} (${result.size}B)` });
          }
          break;
        }
        case ActionType.FILE_EDIT: {
          const path = String(action.payload["path"] ?? "");
          const oldText = String(action.payload["oldText"] ?? "");
          const newText = String(action.payload["newText"] ?? "");
          if (!path) throw new Error("file.edit: path is required");
          if (codexConnected) {
            await this.codex.call("file.edit", { path, oldText, newText });
          } else {
            const result = await this.fileSystem.editFile(path, oldText, newText);
            this.emit("log", { level: "info", message: `Edited: ${result.path}` });
          }
          break;
        }
        case ActionType.TERMINAL_EXEC: {
          const command = String(action.payload["command"] ?? "");
          const cwd = String(action.payload["cwd"] ?? this.project.outputDir);
          if (!command) throw new Error("terminal.exec: command is required");
          if (codexConnected) {
            await this.codex.call("terminal.exec", { command, cwd });
          } else {
            const result = await this.terminal.exec(command, { cwd });
            const output = (result.output || "").slice(0, 300);
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
      fileTree, lastActionOutput: "", lastActionResult: "",
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

  private waitWhilePausedOrWaiting(): Promise<void> {
    return new Promise(resolve => {
      const check = setInterval(() => {
        const blocked = this.isPaused ||
          this.project.status === ProjectStatus.WAITING_APPROVAL ||
          this.project.status === ProjectStatus.WAITING_USER_INPUT;
        if (!blocked) { clearInterval(check); resolve(); }
      }, 500);
    });
  }
}
