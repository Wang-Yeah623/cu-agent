import { describe, it, expect, beforeEach } from "vitest";
import { SecurityGate } from "../src/registry/security";
import { ActionType, ProjectStatus } from "../src/core/types";

describe("SecurityGate", () => {
  let gate: SecurityGate;

  beforeEach(() => {
    gate = new SecurityGate();
  });

  it("allows safe commands", () => {
    const result = gate.checkCommand("npm install express");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("blocks dangerous commands", () => {
    const result = gate.checkCommand("rm -rf /");
    expect(result.allowed).toBe(false);
  });

  it("blocks empty commands", () => {
    const result = gate.checkCommand("");
    expect(result.allowed).toBe(false);
  });

  it("blocks commands exceeding max length", () => {
    const result = gate.checkCommand("x".repeat(6000));
    expect(result.allowed).toBe(false);
  });

  it("requires approval for delete operations", () => {
    const result = gate.checkCommand("rm -rf node_modules");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it("validates file paths within sandbox", () => {
    gate.addAllowedPath("C:\\projects");
    const result = gate.checkFilePath("C:\\projects\\my-app\\src\\index.ts");
    expect(result.allowed).toBe(true);
  });

  it("rejects file paths outside sandbox", () => {
    gate.addAllowedPath("C:\\projects");
    const result = gate.checkFilePath("C:\\Windows\\system32\\config");
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("FILE_DELETE action always requires approval", () => {
    const result = gate.checkAction(ActionType.FILE_DELETE, { path: "test.ts" });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it("FILE_READ action is safe", () => {
    const result = gate.checkAction(ActionType.FILE_READ, { path: "test.ts" });
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("creates and resolves approval requests", () => {
    const request = gate.createApprovalRequest("proj-1", "Delete file", ActionType.FILE_DELETE, { path: "test.ts" }, "safety check");
    expect(request.status).toBe("pending");

    const resolved = gate.resolveApproval(request.id, true);
    expect(resolved).toBe(true);
    expect(request.status).toBe("approved");
    expect(request.resolvedAt).toBeDefined();
  });

  it("does not resolve already-resolved request", () => {
    const request = gate.createApprovalRequest("proj-1", "test", ActionType.FILE_DELETE, {}, "test");
    gate.resolveApproval(request.id, true);
    const again = gate.resolveApproval(request.id, true);
    expect(again).toBe(false);
  });
});
