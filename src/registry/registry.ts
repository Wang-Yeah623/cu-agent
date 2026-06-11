/**
 * Cu Agent — 插件注册表
 *
 * 职责：管理已安装插件的注册、发现、绑定状态。
 * 安全约束：只有注册表中标记为已绑定的软件，才能接收 Cu Engine 的操控指令。
 */

import { EventEmitter } from "events";
import { PluginBinding, generateId, now } from "../core";

export interface RegistryEventMap {
  "plugin:bound": [binding: PluginBinding];
  "plugin:unbound": [pluginId: string];
  "plugin:connected": [pluginId: string];
  "plugin:disconnected": [pluginId: string];
  "plugin:error": [error: Error];
}

/**
 * 插件注册表
 *
 * 线程安全说明：当前为单线程 Node.js 环境，EventEmitter 同步触发。
 * 多线程环境下需加锁。
 */
export class PluginRegistry extends EventEmitter {
  private bindings: Map<string, PluginBinding> = new Map();

  /**
   * 注册并绑定一个插件
   * @param softwareName  软件名称（如 "Codex桌面版"）
   * @param softwareVersion 软件版本号
   * @param bindingKey    用户提供的绑定密钥
   * @param webSocketPort 插件监听的本地 WebSocket 端口
   * @returns 新创建的绑定记录
   * @throws 如果 bindingKey 为空或端口已被占用
   */
  public bind(
    softwareName: string,
    softwareVersion: string,
    bindingKey: string,
    webSocketPort: number
  ): PluginBinding {
    if (!bindingKey || bindingKey.trim().length === 0) {
      throw new Error("Binding key cannot be empty");
    }

    // 检查端口是否已被其他绑定占用
    for (const existing of this.bindings.values()) {
      if (existing.webSocketPort === webSocketPort && existing.connected) {
        throw new Error(
          `Port ${webSocketPort} is already in use by plugin "${existing.softwareName}"`
        );
      }
    }

    const binding: PluginBinding = {
      pluginId: generateId(),
      softwareName,
      softwareVersion,
      bindingKey,
      webSocketPort,
      connected: false,
      boundAt: now(),
    };

    this.bindings.set(binding.pluginId, binding);
    this.emit("plugin:bound", binding);
    return binding;
  }

  /**
   * 解除绑定
   * @param pluginId 插件 ID
   * @returns 是否成功解除
   */
  public unbind(pluginId: string): boolean {
    const existed = this.bindings.has(pluginId);
    if (existed) {
      this.bindings.delete(pluginId);
      this.emit("plugin:unbound", pluginId);
    }
    return existed;
  }

  /**
   * 标记插件为已连接
   */
  public markConnected(pluginId: string): boolean {
    const binding = this.bindings.get(pluginId);
    if (!binding) return false;
    binding.connected = true;
    this.emit("plugin:connected", pluginId);
    return true;
  }

  /**
   * 标记插件为已断开
   */
  public markDisconnected(pluginId: string): boolean {
    const binding = this.bindings.get(pluginId);
    if (!binding) return false;
    binding.connected = false;
    this.emit("plugin:disconnected", pluginId);
    return true;
  }

  /**
   * 获取指定插件的绑定信息
   */
  public getBinding(pluginId: string): PluginBinding | undefined {
    return this.bindings.get(pluginId);
  }

  /**
   * 按软件名称查找已绑定的插件
   */
  public findBySoftwareName(softwareName: string): PluginBinding | undefined {
    for (const binding of this.bindings.values()) {
      if (binding.softwareName === softwareName) {
        return binding;
      }
    }
    return undefined;
  }

  /**
   * 获取所有已绑定的插件
   */
  public getAllBindings(): PluginBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * 获取所有当前已连接的插件
   */
  public getConnectedPlugins(): PluginBinding[] {
    return this.getAllBindings().filter((b) => b.connected);
  }

  /**
   * 校验某个软件是否已被绑定且允许操控
   */
  public isAllowed(softwareName: string): boolean {
    const binding = this.findBySoftwareName(softwareName);
    return binding !== undefined && binding.connected;
  }

  /**
   * 获取绑定总数
   */
  public get size(): number {
    return this.bindings.size;
  }

  /**
   * 清空所有绑定（重置）
   */
  public clear(): void {
    const ids = Array.from(this.bindings.keys());
    this.bindings.clear();
    for (const id of ids) {
      this.emit("plugin:unbound", id);
    }
  }
}
