import { describe, expect, it } from "bun:test";
import { startCloudBackgroundJobs } from "./background-jobs";

describe("cloud background-jobs seam", () => {
  it("starts nothing and returns a no-op stop handle by default", async () => {
    const stop = startCloudBackgroundJobs();
    expect(typeof stop).toBe("function");
    await expect(Promise.resolve(stop())).resolves.toBeUndefined();
  });
});
