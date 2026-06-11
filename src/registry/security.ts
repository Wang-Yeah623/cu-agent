/**
 * Cu Agent — 安全门控层
 *
 * 职责：在执行操控指令前进行安全检查，防止危险操作。
 * 检查维度：命令黑名单、操作白名单、文件路径沙箱、审批门控。
 */

import { ActionType, ApprovalRequest, generateId, now } from "../core";
import { DANGEROUS_COMMANDS, MAX_COMMAND_LENGTH } from "../core/constants";

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

/**
 * 安全门控器
 *
 * 所有执行层操作在真正执行前，必须经过此门控器检查。
 */
export class SecurityGate {
  private approvalQueue: ApprovalRequest[] = [];
  private allowedPaths: string[] = [];

  /**
   * 设置允许操作的文件路径（沙箱路径）
   */
  public setAllowedPaths(paths: string[]): void {
    this.allowedPaths = paths;
  }

  /**
   * 添加一个允许操作的文件路径
   */
  public addAllowedPath(path: string): void {
    if (!this.allowedPaths.includes(path)) {
      this.allowedPaths.push(path);
    }
  }

  /**
   * 检查终端命令是否安全
   */
  public checkCommand(command: string): SecurityCheckResult {
    if (!command || command.trim().length === 0) {
      return { allowed: false, reason: "Command is empty", requiresApproval: false };
    }

    if (command.length > MAX_COMMAND_LENGTH) {
      return {
        allowed: false,
        reason: `Command exceeds max length (${command.length} > ${MAX_COMMAND_LENGTH})`,
        requiresApproval: false,
      };
    }

    // 检查危险命令
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (command.toLowerCase().includes(dangerous.toLowerCase())) {
        return {
          allowed: false,
          reason: `Command contains dangerous pattern: "${dangerous}"`,
          requiresApproval: false,
        };
      }
    }

    // 删除操作需要审批
    const deletePatterns = ["rm ", "rmdir ", "del ", "rd "];
    const hasDeleteCommand = deletePatterns.some((p) =>
      command.toLowerCase().startsWith(p)
    );

    return {
      allowed: true,
      requiresApproval: hasDeleteCommand,
    };
  }

  /**
   * 检查文件路径是否在沙箱内
   */
  public checkFilePath(path: string): SecurityCheckResult {
    if (this.allowedPaths.length === 0) {
      // 沙箱未配置，默认允许但标记需要审批
      return { allowed: true, requiresApproval: true };
    }

    const isAllowed = this.allowedPaths.some((allowed) =>
      path.startsWith(allowed)
    );

    return {
      allowed: isAllowed,
      reason: isAllowed ? undefined : `Path is outside allowed sandbox: ${path}`,
      requiresApproval: !isAllowed,
    };
  }

  /**
   * 检查操作类型是否需要审批
   */
  public checkAction(actionType: ActionType, payload: Record<string, unknown>): SecurityCheckResult {
    switch (actionType) {
      case ActionType.FILE_DELETE:
        return {
          allowed: true,
          requiresApproval: true,
        };

      case ActionType.TERMINAL_EXEC: {
        const command = payload["command"] as string;
        return this.checkCommand(command ?? "");
      }

      case ActionType.FILE_EDIT:
      case ActionType.FILE_CREATE:
        return { allowed: true, requiresApproval: false };

      case ActionType.FILE_READ:
      case ActionType.FILE_LIST:
      case ActionType.IDE_OPEN_FILE:
      case ActionType.IDE_GET_DIAGNOSTICS:
        return { allowed: true, requiresApproval: false };

      default:
        return { allowed: true, requiresApproval: true };
    }
  }

  /**
   * 创建审批请求
   */
  public createApprovalRequest(
    projectId: string,
    description: string,
    actionType: ActionType,
    payload: Record<string, unknown>,
    reason: string
  ): ApprovalRequest {
    const request: ApprovalRequest = {
      id: generateId(),
      projectId,
      description,
      action: actionType,
      payload,
      reason,
      status: "pending",
      createdAt: now(),
    };
    this.approvalQueue.push(request);
    return request;
  }

  /**
   * 获取所有待审批的请求
   */
  public getPendingApprovals(): ApprovalRequest[] {
    return this.approvalQueue.filter((r) => r.status === "pending");
  }

  /**
   * 审批或拒绝
   */
  public resolveApproval(id: string, approved: boolean): boolean {
    const request = this.approvalQueue.find((r) => r.id === id);
    if (!request || request.status !== "pending") return false;
    request.status = approved ? "approved" : "rejected";
    request.resolvedAt = now();
    return true;
  }
}
