/**
 * Cu Agent — 终端适配器
 *
 * 职责：在本地执行终端命令，返回执行结果。
 * 安全约束：所有命令在执行前必须经过 SecurityGate.checkCommand()
 */

import { spawn, SpawnOptions } from "child_process";
import { ExecutionResult } from "../core";
import { TERMINAL_COMMAND_TIMEOUT_MS } from "../core/constants";

export interface TerminalOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * 终端执行器
 *
 * 封装子进程调用，统一超时管理和输出捕获。
 */
export class TerminalAdapter {
  private defaultCwd: string;

  constructor(cwd?: string) {
    this.defaultCwd = cwd ?? process.cwd();
  }

  /**
   * 执行一条命令并等待完成
   */
  public async exec(
    command: string,
    options?: TerminalOptions
  ): Promise<ExecutionResult> {
    const cwd = options?.cwd ?? this.defaultCwd;
    const timeout = options?.timeout ?? TERMINAL_COMMAND_TIMEOUT_MS;
    const startTime = Date.now();

    // 在 Windows 上，通过 cmd /c 执行；在 Unix 上通过 sh -c 执行
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const shellArgs = isWindows ? ["/c", command] : ["-c", command];

    return new Promise((resolve) => {
      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...options?.env },
        windowsHide: true,
      } as SpawnOptions);

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill(isWindows ? "SIGTERM" : "SIGKILL");
      }, timeout);

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            output: stdout,
            error: `Command timed out after ${timeout}ms`,
            exitCode: -1,
            durationMs,
          });
        } else {
          resolve({
            success: exitCode === 0,
            output: stdout,
            error: stderr || undefined,
            exitCode: exitCode ?? -1,
            durationMs,
          });
        }
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: "",
          error: err.message,
          exitCode: -1,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * 校验命令是否可以安全执行
   * 安全门控在调用方（SecurityGate.checkCommand()）实现
   */
  public static validateCommand(command: string): boolean {
    return command.trim().length > 0;
  }
}
