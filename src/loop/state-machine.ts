/**
 * Cu Agent — 状态机
 *
 * 职责：管理项目的生命周期状态转换。
 * 状态图见产品设计文档第 6 节。
 */

import { ProjectStatus } from "../core";

export type StateTransitionHandler = (
  from: ProjectStatus,
  to: ProjectStatus,
  reason?: string
) => void;

/**
 * 项目状态机
 *
 * 约束：
 * - 只能在允许的转换路径上切换状态
 * - 非法转换会抛异常
 * - 支持转换监听器
 */
export class StateMachine {
  private current: ProjectStatus;
  private transitions: Map<string, ProjectStatus[]> = new Map();
  private listeners: StateTransitionHandler[] = [];

  constructor(initialState: ProjectStatus = ProjectStatus.IDLE) {
    this.current = initialState;
    this.defineTransitions();
  }

  /**
   * 定义允许的状态转换路径
   */
  private defineTransitions(): void {
    this.transitions.set(ProjectStatus.IDLE, [
      ProjectStatus.PLANNING,
    ]);

    this.transitions.set(ProjectStatus.PLANNING, [
      ProjectStatus.EXECUTING,
      ProjectStatus.FAILED,
      ProjectStatus.IDLE,
    ]);

    this.transitions.set(ProjectStatus.EXECUTING, [
      ProjectStatus.WAITING_APPROVAL,
      ProjectStatus.WAITING_USER_INPUT,
      ProjectStatus.PAUSED,
      ProjectStatus.COMPLETED,
      ProjectStatus.FAILED,
    ]);

    this.transitions.set(ProjectStatus.WAITING_APPROVAL, [
      ProjectStatus.EXECUTING,
      ProjectStatus.FAILED,
      ProjectStatus.PAUSED,
    ]);

    this.transitions.set(ProjectStatus.WAITING_USER_INPUT, [
      ProjectStatus.EXECUTING,
      ProjectStatus.PAUSED,
      ProjectStatus.FAILED,
    ]);

    this.transitions.set(ProjectStatus.PAUSED, [
      ProjectStatus.EXECUTING,
      ProjectStatus.IDLE,
      ProjectStatus.FAILED,
    ]);

    this.transitions.set(ProjectStatus.COMPLETED, [
      ProjectStatus.IDLE,
    ]);

    this.transitions.set(ProjectStatus.FAILED, [
      ProjectStatus.IDLE,
      ProjectStatus.PLANNING,
    ]);
  }

  /**
   * 获取当前状态
   */
  public get state(): ProjectStatus {
    return this.current;
  }

  /**
   * 尝试切换到目标状态
   * @throws 如果转换路径不允许
   */
  public transitionTo(target: ProjectStatus, reason?: string): void {
    const allowed = this.transitions.get(this.current);
    if (!allowed) {
      throw new Error(
        `No transitions defined from state: ${this.current}`
      );
    }

    if (!allowed.includes(target)) {
      throw new Error(
        `Invalid transition: ${this.current} → ${target}. ` +
        `Allowed: [${allowed.join(", ")}]`
      );
    }

    const from = this.current;
    this.current = target;
    this.notifyListeners(from, target, reason);
  }

  /**
   * 检查是否允许转换到目标状态
   */
  public canTransitionTo(target: ProjectStatus): boolean {
    const allowed = this.transitions.get(this.current);
    return allowed ? allowed.includes(target) : false;
  }

  /**
   * 获取所有可能的后续状态
   */
  public getAvailableTransitions(): ProjectStatus[] {
    return this.transitions.get(this.current) ?? [];
  }

  /**
   * 添加状态转换监听器
   */
  public onTransition(handler: StateTransitionHandler): void {
    this.listeners.push(handler);
  }

  /**
   * 移除状态转换监听器
   */
  public offTransition(handler: StateTransitionHandler): void {
    const index = this.listeners.indexOf(handler);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 重置到初始状态
   */
  public reset(): void {
    const from = this.current;
    this.current = ProjectStatus.IDLE;
    this.notifyListeners(from, ProjectStatus.IDLE, "reset");
  }

  private notifyListeners(
    from: ProjectStatus,
    to: ProjectStatus,
    reason?: string
  ): void {
    for (const handler of this.listeners) {
      try {
        handler(from, to, reason);
      } catch {
        // 监听器异常不影响主流程
      }
    }
  }
}
