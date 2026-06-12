/**
 * Cu Agent — 执行状态持久化
 *
 * 职责：把执行循环的项目/任务/进度状态写到磁盘，进程重启后可恢复（用于查询/汇报）。
 * 约束：尽力而为（best-effort），任何 IO 失败都不应影响主流程。
 *
 * 说明：JSON 序列化会把 Date 转成 ISO 字符串。恢复出来的状态主要用于
 *       展示「进度/状态」，不保证能就地续跑（续跑是更上层的能力）。
 */

import * as fs from "fs";
import * as path from "path";
import { Project, SubTask, ProgressSnapshot } from "../core";

export interface PersistedState {
  project: Project;
  tasks: SubTask[];
  completedTasks: SubTask[];
  currentTaskIndex: number;
  latestSnapshot?: ProgressSnapshot;
  savedAt: string;
}

/**
 * 状态存储：单文件 JSON，默认放在项目输出目录下。
 */
export class StateStore {
  private readonly filePath: string;

  constructor(dir: string, fileName: string = ".cu-agent-state.json") {
    this.filePath = path.join(path.resolve(dir), fileName);
  }

  /** 当前状态文件路径 */
  public get path(): string {
    return this.filePath;
  }

  /** 写入状态（尽力而为，失败静默） */
  public save(state: PersistedState): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch {
      /* best-effort: 持久化失败不影响执行 */
    }
  }

  /** 读取状态；不存在或损坏时返回 null */
  public load(): PersistedState | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as PersistedState;
    } catch {
      return null;
    }
  }

  /** 删除状态文件 */
  public clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch {
      /* ignore */
    }
  }
}
