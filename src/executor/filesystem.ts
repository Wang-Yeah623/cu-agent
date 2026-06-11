/**
 * Cu Agent — 文件系统适配器
 *
 * 职责：提供安全的本地文件读写操作。
 * 安全约束：所有操作前应经过 SecurityGate.checkFilePath() 检查。
 */

import * as fs from "fs";
import * as path from "path";
import { FileEntry } from "../core";

export interface FileOptions {
  encoding?: BufferEncoding;
}

/**
 * 文件系统适配器
 *
 * 封装 Node.js fs API，提供统一的文件操作接口。
 */
export class FileSystemAdapter {
  /**
   * 创建文件（含父目录）
   */
  public async createFile(
    filePath: string,
    content: string,
    overwrite: boolean = false
  ): Promise<{ path: string; size: number }> {
    const absolutePath = path.resolve(filePath);

    // 检查文件是否已存在
    if (!overwrite && fs.existsSync(absolutePath)) {
      throw new Error(`File already exists: ${absolutePath}`);
    }

    // 确保父目录存在
    const dir = path.dirname(absolutePath);
    fs.mkdirSync(dir, { recursive: true });

    // 写入文件
    fs.writeFileSync(absolutePath, content, "utf-8");

    const stats = fs.statSync(absolutePath);
    return { path: absolutePath, size: stats.size };
  }

  /**
   * 读取文件内容
   */
  public async readFile(filePath: string): Promise<{ content: string; size: number }> {
    const absolutePath = path.resolve(filePath);
    const content = fs.readFileSync(absolutePath, "utf-8");
    const stats = fs.statSync(absolutePath);
    return { content, size: stats.size };
  }

  /**
   * 编辑文件（文本替换）
   */
  public async editFile(
    filePath: string,
    oldText: string,
    newText: string
  ): Promise<{ path: string; changed: boolean; lineCount: number }> {
    const absolutePath = path.resolve(filePath);
    const content = fs.readFileSync(absolutePath, "utf-8");

    if (!content.includes(oldText)) {
      throw new Error(
        `oldText not found in file: ${absolutePath}\nLooking for: "${oldText}"`
      );
    }

    const updated = content.replace(oldText, newText);
    fs.writeFileSync(absolutePath, updated, "utf-8");

    const lineCount = updated.split("\n").length;
    return {
      path: absolutePath,
      changed: content !== updated,
      lineCount,
    };
  }

  /**
   * 删除文件
   */
  public async deleteFile(
    filePath: string,
    force: boolean = false
  ): Promise<{ path: string; deleted: boolean }> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      if (force) {
        return { path: absolutePath, deleted: false };
      }
      throw new Error(`File not found: ${absolutePath}`);
    }

    fs.unlinkSync(absolutePath);
    return { path: absolutePath, deleted: true };
  }

  /**
   * 列出目录内容
   */
  public async listDirectory(
    dirPath: string,
    recursive: boolean = false
  ): Promise<FileEntry[]> {
    const absolutePath = path.resolve(dirPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Directory not found: ${absolutePath}`);
    }

    const entries: FileEntry[] = [];
    this.collectEntries(absolutePath, "", entries, recursive);
    return entries;
  }

  /**
   * 获取项目文件树（字符串形式，便于 LLM 理解）
   */
  public async getFileTree(dirPath: string): Promise<string> {
    const absolutePath = path.resolve(dirPath);
    if (!fs.existsSync(absolutePath)) return "(directory does not exist)";

    const lines: string[] = [];
    this.buildTree(absolutePath, "", lines);
    return lines.join("\n");
  }

  private collectEntries(
    basePath: string,
    relativePath: string,
    entries: FileEntry[],
    recursive: boolean
  ): void {
    const currentPath = path.join(basePath, relativePath);
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stats = fs.statSync(itemPath);
      const entry: FileEntry = {
        name: item,
        path: path.join(relativePath, item).replace(/\\/g, "/"),
        isDirectory: stats.isDirectory(),
        size: stats.isFile() ? stats.size : undefined,
        lastModified: stats.mtimeMs,
      };
      entries.push(entry);

      if (recursive && stats.isDirectory()) {
        this.collectEntries(basePath, path.join(relativePath, item), entries, true);
      }
    }
  }

  private buildTree(dirPath: string, prefix: string, lines: string[]): void {
    try {
      const items = fs.readdirSync(dirPath).filter(
        (item) => !item.startsWith(".") && item !== "node_modules"
      );
      items.sort();

      for (let i = 0; i < items.length; i++) {
        const isLast = i === items.length - 1;
        const item = items[i];
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);

        const connector = isLast ? "└── " : "├── ";
        lines.push(`${prefix}${connector}${item}`);

        if (stats.isDirectory()) {
          const nextPrefix = isLast ? "    " : "│   ";
          this.buildTree(itemPath, prefix + nextPrefix, lines);
        }
      }
    } catch {
      lines.push(`${prefix}└── (error reading directory)`);
    }
  }
}
