import { describe, it, expect } from "vitest";
import {
  SubtaskSchema,
  PlanOutputSchema,
  RevisionOutputSchema,
} from "../types.js";

describe("SubtaskSchema", () => {
  it("parses a valid subtask", () => {
    const result = SubtaskSchema.parse({
      id: "1",
      description: "Implement auth middleware",
    });
    expect(result.id).toBe("1");
    expect(result.description).toBe("Implement auth middleware");
    expect(result.dependencies).toEqual([]);
    expect(result.workerCli).toBeUndefined();
  });

  it("parses subtask with all fields", () => {
    const result = SubtaskSchema.parse({
      id: "2",
      description: "Add frontend form",
      dependencies: ["1"],
      workerCli: "codex",
    });
    expect(result.dependencies).toEqual(["1"]);
    expect(result.workerCli).toBe("codex");
  });

  it("rejects subtask with empty id", () => {
    expect(() =>
      SubtaskSchema.parse({ id: "", description: "task" }),
    ).toThrow();
  });

  it("rejects subtask with empty description", () => {
    expect(() =>
      SubtaskSchema.parse({ id: "1", description: "" }),
    ).toThrow();
  });

  it("rejects subtask without id", () => {
    expect(() =>
      SubtaskSchema.parse({ description: "task" }),
    ).toThrow();
  });

  it("rejects subtask without description", () => {
    expect(() =>
      SubtaskSchema.parse({ id: "1" }),
    ).toThrow();
  });
});

describe("PlanOutputSchema", () => {
  it("parses a valid plan with one subtask", () => {
    const result = PlanOutputSchema.parse({
      subtasks: [{ id: "1", description: "Do the thing" }],
    });
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].dependencies).toEqual([]);
    expect(result.summary).toBeUndefined();
  });

  it("parses plan with summary and dependencies", () => {
    const result = PlanOutputSchema.parse({
      subtasks: [
        { id: "1", description: "Backend API", dependencies: [] },
        { id: "2", description: "Frontend UI", dependencies: ["1"] },
      ],
      summary: "Full-stack feature",
    });
    expect(result.subtasks).toHaveLength(2);
    expect(result.subtasks[1].dependencies).toEqual(["1"]);
    expect(result.summary).toBe("Full-stack feature");
  });

  it("rejects plan with zero subtasks", () => {
    expect(() =>
      PlanOutputSchema.parse({ subtasks: [] }),
    ).toThrow("Plan must contain at least one subtask");
  });

  it("rejects plan without subtasks field", () => {
    expect(() =>
      PlanOutputSchema.parse({ summary: "no tasks" }),
    ).toThrow();
  });
});

describe("RevisionOutputSchema", () => {
  it("parses done revision with empty followUps", () => {
    const result = RevisionOutputSchema.parse({
      done: true,
      summary: "All tasks completed successfully",
    });
    expect(result.done).toBe(true);
    expect(result.summary).toBe("All tasks completed successfully");
    expect(result.followUpSubtasks).toEqual([]);
  });

  it("parses revision with follow-up subtasks", () => {
    const result = RevisionOutputSchema.parse({
      done: false,
      summary: "Frontend needs fixes",
      followUpSubtasks: [
        { id: "3", description: "Fix validation bug" },
      ],
    });
    expect(result.done).toBe(false);
    expect(result.followUpSubtasks).toHaveLength(1);
    expect(result.followUpSubtasks[0].id).toBe("3");
  });

  it("rejects revision without done field", () => {
    expect(() =>
      RevisionOutputSchema.parse({ summary: "missing done" }),
    ).toThrow();
  });

  it("rejects revision without summary", () => {
    expect(() =>
      RevisionOutputSchema.parse({ done: true }),
    ).toThrow();
  });
});
