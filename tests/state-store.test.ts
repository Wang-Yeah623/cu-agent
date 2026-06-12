import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { StateStore, PersistedState } from "../src/loop/state-store";
import { ProjectStatus, TaskStatus } from "../src/core/types";

const TMP_DIR = path.join(__dirname, "..", ".test-state");

function sampleState(): PersistedState {
  return {
    project: {
      id: "p1",
      name: "Demo",
      requirement: "做个博客",
      requirementSummary: "",
      techStack: { framework: "Next.js" },
      outputDir: TMP_DIR,
      status: ProjectStatus.EXECUTING,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tasks: [
      {
        id: "t1", projectId: "p1", name: "初始化", description: "",
        status: TaskStatus.COMPLETED, order: 0, dependsOn: [],
        actions: [], progressAtCompletion: 50,
      },
    ],
    completedTasks: [],
    currentTaskIndex: 0,
    savedAt: new Date().toISOString(),
  };
}

describe("StateStore", () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore(TMP_DIR);
    store.clear();
  });

  afterEach(() => {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns null when no state file exists", () => {
    expect(store.load()).toBeNull();
  });

  it("saves and loads state round-trip", () => {
    const state = sampleState();
    store.save(state);
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.project.id).toBe("p1");
    expect(loaded!.project.status).toBe(ProjectStatus.EXECUTING);
    expect(loaded!.tasks).toHaveLength(1);
    expect(loaded!.tasks[0].name).toBe("初始化");
    expect(loaded!.currentTaskIndex).toBe(0);
  });

  it("persists to disk at the expected path", () => {
    store.save(sampleState());
    expect(fs.existsSync(store.path)).toBe(true);
  });

  it("clear removes the state file", () => {
    store.save(sampleState());
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("returns null on corrupted JSON instead of throwing", () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.writeFileSync(store.path, "{ not valid json", "utf-8");
    expect(() => store.load()).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
