import { describe, it, expect, beforeEach } from "vitest";
import { PluginRegistry } from "../src/registry/registry";

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it("binds a plugin and returns binding", () => {
    const binding = registry.bind("Codex桌面版", "1.0.0", "key-123", 9876);
    expect(binding.pluginId).toBeDefined();
    expect(binding.softwareName).toBe("Codex桌面版");
    expect(binding.connected).toBe(false);
  });

  it("rejects empty binding key", () => {
    expect(() => registry.bind("Test", "1.0", "", 1234)).toThrow();
  });

  it("rejects duplicate port when first is connected", () => {
    const { pluginId } = registry.bind("Plugin A", "1.0", "key-a", 9876);
    registry.markConnected(pluginId);
    expect(() => registry.bind("Plugin B", "1.0", "key-b", 9876)).toThrow();
  });

  it("unbind removes plugin", () => {
    const { pluginId } = registry.bind("Test", "1.0", "key", 1234);
    expect(registry.size).toBe(1);
    registry.unbind(pluginId);
    expect(registry.size).toBe(0);
  });

  it("markConnected changes connection state", () => {
    const { pluginId } = registry.bind("Test", "1.0", "key", 1234);
    registry.markConnected(pluginId);
    expect(registry.getBinding(pluginId)?.connected).toBe(true);
  });

  it("findBySoftwareName works", () => {
    registry.bind("Codex桌面版", "1.0", "key", 9876);
    const found = registry.findBySoftwareName("Codex桌面版");
    expect(found).toBeDefined();
    expect(found!.softwareName).toBe("Codex桌面版");
  });

  it("isAllowed returns true only when connected", () => {
    const { pluginId } = registry.bind("Codex桌面版", "1.0", "key", 9876);
    expect(registry.isAllowed("Codex桌面版")).toBe(false);
    registry.markConnected(pluginId);
    expect(registry.isAllowed("Codex桌面版")).toBe(true);
  });

  it("getConnectedPlugins returns only connected", () => {
    registry.bind("A", "1.0", "k1", 1001);
    const b = registry.bind("B", "1.0", "k2", 1002);
    registry.markConnected(b.pluginId);
    expect(registry.getConnectedPlugins()).toHaveLength(1);
  });

  it("clear removes all", () => {
    registry.bind("A", "1.0", "k1", 1001);
    registry.bind("B", "1.0", "k2", 1002);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
