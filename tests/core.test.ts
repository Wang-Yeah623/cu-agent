import { describe, it, expect } from "vitest";
import { ProjectStatus, TaskStatus, ActionType, DeviationLevel, UserIntentAction, generateId } from "../src/core/types";
import { PluginMessageType, PluginMethod, PluginEvent } from "../src/core/protocol";

describe("core/types", () => {
  it("generateId returns a unique uuid", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });

  it("enums have expected values", () => {
    expect(ProjectStatus.IDLE).toBe("idle");
    expect(ProjectStatus.EXECUTING).toBe("executing");
    expect(TaskStatus.COMPLETED).toBe("completed");
    expect(ActionType.FILE_CREATE).toBe("file.create");
    expect(DeviationLevel.MAJOR).toBe("major");
    expect(UserIntentAction.CREATE_PROJECT).toBe("CREATE_PROJECT");
  });

  it("ActionType includes CODE_GENERATE", () => {
    expect(ActionType.CODE_GENERATE).toBe("code.generate");
  });
});

describe("core/protocol", () => {
  it("PluginMessageType has expected values", () => {
    expect(PluginMessageType.REQUEST).toBe("request");
    expect(PluginMessageType.RESPONSE).toBe("response");
    expect(PluginMessageType.EVENT).toBe("event");
  });

  it("PluginEvent includes all event types", () => {
    expect(PluginEvent.FILE_CHANGED).toBe("file.changed");
    expect(PluginEvent.PLUGIN_READY).toBe("plugin.ready");
    expect(PluginEvent.PLUGIN_CLOSING).toBe("plugin.closing");
  });
});
