import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine } from "../src/loop/state-machine";
import { ProjectStatus } from "../src/core/types";

describe("StateMachine", () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  it("starts in IDLE", () => {
    expect(sm.state).toBe(ProjectStatus.IDLE);
  });

  it("allows IDLE → PLANNING", () => {
    sm.transitionTo(ProjectStatus.PLANNING);
    expect(sm.state).toBe(ProjectStatus.PLANNING);
  });

  it("allows PLANNING → EXECUTING", () => {
    sm.transitionTo(ProjectStatus.PLANNING);
    sm.transitionTo(ProjectStatus.EXECUTING);
    expect(sm.state).toBe(ProjectStatus.EXECUTING);
  });

  it("blocks invalid transition: IDLE → COMPLETED", () => {
    expect(() => sm.transitionTo(ProjectStatus.COMPLETED)).toThrow();
  });

  it("blocks invalid transition: EXECUTING → PLANNING", () => {
    sm.transitionTo(ProjectStatus.PLANNING);
    sm.transitionTo(ProjectStatus.EXECUTING);
    expect(() => sm.transitionTo(ProjectStatus.PLANNING)).toThrow();
  });

  it("allows EXECUTING → PAUSED → EXECUTING", () => {
    sm.transitionTo(ProjectStatus.PLANNING);
    sm.transitionTo(ProjectStatus.EXECUTING);
    sm.transitionTo(ProjectStatus.PAUSED);
    expect(sm.state).toBe(ProjectStatus.PAUSED);
    sm.transitionTo(ProjectStatus.EXECUTING);
    expect(sm.state).toBe(ProjectStatus.EXECUTING);
  });

  it("allows COMPLETED → IDLE to restart", () => {
    sm.transitionTo(ProjectStatus.PLANNING);
    sm.transitionTo(ProjectStatus.EXECUTING);
    sm.transitionTo(ProjectStatus.COMPLETED);
    expect(sm.state).toBe(ProjectStatus.COMPLETED);
    sm.transitionTo(ProjectStatus.IDLE);
    expect(sm.state).toBe(ProjectStatus.IDLE);
  });

  it("fires transition listeners", () => {
    const transitions: string[] = [];
    sm.onTransition((from, to) => transitions.push(`${from}→${to}`));
    sm.transitionTo(ProjectStatus.PLANNING);
    sm.transitionTo(ProjectStatus.EXECUTING);
    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toContain("idle");
    expect(transitions[1]).toContain("planning");
  });

  it("canTransitionTo returns correct value", () => {
    expect(sm.canTransitionTo(ProjectStatus.PLANNING)).toBe(true);
    expect(sm.canTransitionTo(ProjectStatus.COMPLETED)).toBe(false);
  });

  it("reset goes back to IDLE", () => {
    sm.transitionTo(ProjectStatus.PLANNING);
    sm.reset();
    expect(sm.state).toBe(ProjectStatus.IDLE);
  });
});
