import { describe, it, expect } from "bun:test";
import { defaultPermissionChecker as checker } from "../default-permission-checker";

describe("DefaultPermissionChecker", () => {
  const owner = { userId: "u1", organizationId: "o1", role: "owner" };
  const admin = { userId: "u2", organizationId: "o1", role: "admin" };
  const member = { userId: "u3", organizationId: "o1", role: "member" };
  const none = { userId: "u4", organizationId: "o1", role: null };

  it("grants all actions to owner", () => {
    expect(checker.can(owner, "work-item.delete")).toBe(true);
    expect(checker.can(owner, "project.transfer")).toBe(true);
    expect(checker.can(owner, "anything.else")).toBe(true);
  });

  it("grants all actions to admin", () => {
    expect(checker.can(admin, "work-item.delete")).toBe(true);
    expect(checker.can(admin, "project.transfer")).toBe(true);
  });

  it("denies project management actions to members", () => {
    expect(checker.can(member, "work-item.delete")).toBe(false);
    expect(checker.can(member, "project.transfer")).toBe(false);
    expect(checker.can(member, "project.delete")).toBe(false);
    expect(checker.can(member, "organization.invite")).toBe(false);
  });

  it("allows non-management actions for members", () => {
    expect(checker.can(member, "work-item.comment")).toBe(true);
    expect(checker.can(member, "project.view")).toBe(true);
  });

  it("denies everything when role is null", () => {
    expect(checker.can(none, "work-item.comment")).toBe(false);
    expect(checker.can(none, "project.view")).toBe(false);
  });
});
