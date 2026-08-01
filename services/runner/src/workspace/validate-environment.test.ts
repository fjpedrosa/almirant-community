import { describe, expect, it, mock } from "bun:test";

import { SERVE_READINESS_TIMEOUT_MS, waitForServeReady } from "./validate-environment";

const withFetch = async (impl: typeof fetch, run: () => Promise<void>): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

const refused = (): Promise<Response> => Promise.reject(new Error("ECONNREFUSED"));

describe("waitForServeReady", () => {
  it("returns as soon as the serve answers", async () => {
    await withFetch(
      (async () => new Response("{}", { status: 200 })) as typeof fetch,
      async () => {
        await waitForServeReady("http://container:4096");
      },
    );
  });

  it("treats any HTTP status as listening, including 500", async () => {
    await withFetch(
      (async () => new Response("boom", { status: 500 })) as typeof fetch,
      async () => {
        await waitForServeReady("http://container:4096");
      },
    );
  });

  it("fails immediately once the container is gone, naming the real cause", async () => {
    const isContainerAlive = mock(async () => false);

    await withFetch(refused as unknown as typeof fetch, async () => {
      const startedAt = Date.now();
      const error = await waitForServeReady("http://container:4096", { isContainerAlive })
        .then(() => null)
        .catch((err: Error) => err);

      expect(error?.message).toContain("the container exited before it started listening");
      // The point of the check: it must not burn the full readiness budget.
      expect(Date.now() - startedAt).toBeLessThan(SERVE_READINESS_TIMEOUT_MS);
      expect(isContainerAlive).toHaveBeenCalled();
    });
  });

  it("keeps waiting while the container is alive but not yet listening", async () => {
    let attempts = 0;
    const isContainerAlive = mock(async () => true);

    await withFetch(
      (async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("ECONNREFUSED");
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      async () => {
        await waitForServeReady("http://container:4096", { isContainerAlive });
      },
    );

    expect(attempts).toBe(3);
    expect(isContainerAlive).toHaveBeenCalledTimes(2);
  });

  it("keeps waiting when the liveness probe itself fails", async () => {
    let attempts = 0;
    const isContainerAlive = mock(async () => {
      throw new Error("docker daemon unreachable");
    });

    await withFetch(
      (async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("ECONNREFUSED");
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
      async () => {
        // An inspect failure says nothing about the container, so it must not
        // be read as "exited" — that would abort healthy jobs on a daemon blip.
        await waitForServeReady("http://container:4096", { isContainerAlive });
      },
    );

    expect(attempts).toBe(2);
  });
});
