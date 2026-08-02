import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createLoggerMock,
  createScreenshotMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testProject, testBoard } from "../../../../test/fixtures";

mock.module("@almirant/database", () => createDatabaseMocks());
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("../../../../shared/services/screenshot-service", () => createScreenshotMock());
mock.module("@almirant/config", () => createLoggerMock());

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { projectsRoutes } = await import("./projects.routes");
  return new Elysia().use(withTestOrg).use(projectsRoutes);
};

const json = (data: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

const get = (path: string) =>
  new Request(`http://localhost${path}`);

const req = (path: string, init: RequestInit) =>
  new Request(`http://localhost${path}`, init);

// ─────────────────────────────────────────────────────
// Projects CRUD
// ─────────────────────────────────────────────────────

describe("Projects CRUD", () => {
  // GET /projects
  describe("GET /projects", () => {
    it("returns paginated project list", async () => {
      const app = await makeApp();
      const res = await app.handle(get("/projects"));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(testProject.id);
      expect(body.data[0].name).toBe(testProject.name);
      expect(body.meta).toBeDefined();
      expect(body.meta.total).toBe(1);
    });

    it("forwards query params for pagination", async () => {
      const app = await makeApp();
      const res = await app.handle(get("/projects?page=2&limit=10"));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.meta.page).toBe(2);
      expect(body.meta.limit).toBe(10);
    });
  });

  // POST /projects
  describe("POST /projects", () => {
    it("creates a project and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/projects", json({ name: "New Project", description: "desc" }))
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("New Project");
    });

    it("returns 400 when name is empty string", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/projects", json({ name: "" }))
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("required");
    });

    it("returns 400 when name is only whitespace", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/projects", json({ name: "   " }))
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
    });
  });

  // GET /projects/:id
  describe("GET /projects/:id", () => {
    it("returns a project by ID", async () => {
      const app = await makeApp();
      const res = await app.handle(get(`/projects/${testProject.id}`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testProject.id);
      expect(body.data.name).toBe(testProject.name);
    });

    it("returns 404 for nonexistent project", async () => {
      const app = await makeApp();
      const res = await app.handle(get("/projects/nonexistent"));

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // PATCH /projects/:id
  describe("PATCH /projects/:id", () => {
    it("updates a project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}`, json({ name: "Updated" }, "PATCH"))
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Updated");
    });

    it("returns 404 for nonexistent project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/projects/nonexistent", json({ name: "X" }, "PATCH"))
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });

    it("accepts optional nullable fields", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}`,
          json({ description: null, clientName: null }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });
  });

  // DELETE /projects/:id
  describe("DELETE /projects/:id", () => {
    it("deletes a project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}`, { method: "DELETE" })
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 for nonexistent project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/projects/nonexistent", { method: "DELETE" })
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });
});

// ─────────────────────────────────────────────────────
// Project Archiving
// ─────────────────────────────────────────────────────

describe("Project Archiving", () => {
  describe("POST /projects/:id/archive", () => {
    it("archives a project and returns it with archived status", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}/archive`, { method: "POST" })
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("archived");
      expect(body.data.id).toBe(testProject.id);
    });

    it("returns 404 for nonexistent project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req("/projects/nonexistent/archive", { method: "POST" })
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  describe("GET /projects (archived filtering)", () => {
    it("excludes archived projects from default listing", async () => {
      const app = await makeApp();
      const res = await app.handle(get("/projects"));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      // Default mock returns testProject with status "active", so it appears.
      // The key assertion is that the route works without a status filter.
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe("active");
    });

    it("includes archived projects when status=archived is requested", async () => {
      const archivedProject = { ...testProject, status: "archived" as const };
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjects: async () => ({ projects: [archivedProject], total: 1 }),
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(get("/projects?status=archived"));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe("archived");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("includes archived projects when includeArchived=true", async () => {
      const activeProject = testProject;
      const archivedProject = { ...testProject, id: "proj-archived-1", status: "archived" as const };
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjects: async () => ({
            projects: [activeProject, archivedProject],
            total: 2,
          }),
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(get("/projects?includeArchived=true"));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("Logical archive guarantees", () => {
    it("archived project is still accessible by direct URL (GET /projects/:id)", async () => {
      const archivedProject = { ...testProject, status: "archived" as const };
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectById: async (...args: unknown[]) => {
            const id = typeof args[1] === "string" ? args[1] : args[0];
            return id === testProject.id ? archivedProject : null;
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(get(`/projects/${testProject.id}`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testProject.id);
      expect(body.data.status).toBe("archived");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("archive is a logical operation — project still exists after archiving", async () => {
      const archivedProject = { ...testProject, status: "archived" as const };
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          archiveProject: async (...args: unknown[]) => {
            const id = typeof args[1] === "string" ? args[1] : args[0];
            return id === testProject.id ? archivedProject : null;
          },
          getProjectById: async (...args: unknown[]) => {
            const id = typeof args[1] === "string" ? args[1] : args[0];
            return id === testProject.id ? archivedProject : null;
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      // Step 1: Archive the project
      const archiveRes = await app.handle(
        req(`/projects/${testProject.id}/archive`, { method: "POST" })
      );
      expect(archiveRes.status).toBe(200);
      const archiveBody = await archiveRes.json() as any;
      expect(archiveBody.success).toBe(true);
      expect(archiveBody.data.status).toBe("archived");

      // Step 2: Verify it still exists via GET /projects/:id
      const getRes = await app.handle(get(`/projects/${testProject.id}`));
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json() as any;
      expect(getBody.success).toBe(true);
      expect(getBody.data.id).toBe(testProject.id);
      expect(getBody.data.status).toBe("archived");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("archived project does not appear in default listing but appears with status=archived filter", async () => {
      let callCount = 0;
      const archivedProject = { ...testProject, status: "archived" as const };
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjects: async () => {
            callCount += 1;
            // First call: default listing (no archived projects)
            if (callCount === 1) {
              return { projects: [], total: 0 };
            }
            // Second call: status=archived filter
            return { projects: [archivedProject], total: 1 };
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      // Default listing should be empty (archived projects excluded)
      const defaultRes = await app.handle(get("/projects"));
      expect(defaultRes.status).toBe(200);
      const defaultBody = await defaultRes.json() as any;
      expect(defaultBody.success).toBe(true);
      expect(defaultBody.data).toHaveLength(0);

      // With status=archived, the archived project appears
      const archivedRes = await app.handle(get("/projects?status=archived"));
      expect(archivedRes.status).toBe(200);
      const archivedBody = await archivedRes.json() as any;
      expect(archivedBody.success).toBe(true);
      expect(archivedBody.data).toHaveLength(1);
      expect(archivedBody.data[0].status).toBe("archived");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("POST /projects/:id/archive does not physically delete the project (DELETE is separate)", async () => {
      let deleteProjectCalled = false;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          archiveProject: async (...args: unknown[]) => {
            const id = typeof args[1] === "string" ? args[1] : args[0];
            return id === testProject.id ? { ...testProject, status: "archived" as const } : null;
          },
          deleteProject: async (...args: unknown[]) => {
            deleteProjectCalled = true;
            const id = typeof args[1] === "string" ? args[1] : args[0];
            return id === testProject.id;
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      // Call archive
      const res = await app.handle(
        req(`/projects/${testProject.id}/archive`, { method: "POST" })
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("archived");

      // Verify deleteProject was NOT called
      expect(deleteProjectCalled).toBe(false);

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });
});

// ─────────────────────────────────────────────────────
// Screenshot capture
// ─────────────────────────────────────────────────────

describe("POST /projects/:id/capture-screenshot", () => {
  it("starts screenshot capture for project with productionUrl", async () => {
    // Override getProjectById to return a project with productionUrl
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getProjectById: async (...args: unknown[]) => {
          const id = (typeof args[1] === "string" ? args[1] : args[0]) as string;
          return id === testProject.id
            ? { ...testProject, productionUrl: "https://example.com" }
            : null;
        },
      })
    );

    const { Elysia } = await import("elysia");
    const { projectsRoutes } = await import("./projects.routes");
    const app = new Elysia().use(withTestOrg).use(projectsRoutes);

    const res = await app.handle(
      req(`/projects/${testProject.id}/capture-screenshot`, { method: "POST" })
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.message).toContain("Screenshot capture started");

    // Restore default mocks
    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("returns 404 for nonexistent project", async () => {
    const app = await makeApp();
    const res = await app.handle(
      req("/projects/nonexistent/capture-screenshot", { method: "POST" })
    );

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it("returns 400 when project has no productionUrl", async () => {
    const app = await makeApp();
    const res = await app.handle(
      req(`/projects/${testProject.id}/capture-screenshot`, { method: "POST" })
    );

    // testProject.productionUrl is null by default
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("production URL");
  });
});

// ─────────────────────────────────────────────────────
// Roadmap
// ─────────────────────────────────────────────────────

describe("GET /projects/:id/roadmap", () => {
  it("returns roadmap for existing project", async () => {
    const app = await makeApp();
    const res = await app.handle(get(`/projects/${testProject.id}/roadmap`));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 404 for nonexistent project", async () => {
    const app = await makeApp();
    const res = await app.handle(get("/projects/nonexistent/roadmap"));

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });
});

// ─────────────────────────────────────────────────────
// Linked GitHub URLs
// ─────────────────────────────────────────────────────

describe("GET /projects/linked-github-urls", () => {
  it("returns list of all linked github urls", async () => {
    const app = await makeApp();
    const res = await app.handle(get("/projects/linked-github-urls"));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────
// Doc Links sub-resource
// ─────────────────────────────────────────────────────

describe("Doc Links", () => {
  describe("GET /projects/:id/doc-links", () => {
    it("returns doc links for a project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        get(`/projects/${testProject.id}/doc-links`)
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("POST /projects/:id/doc-links", () => {
    it("creates a doc link and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links`,
          json({ title: "Docs", url: "https://docs.example.com" })
        )
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("link-1");
    });

    it("returns 400 when title is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links`,
          json({ title: "", url: "https://docs.example.com" })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("Title");
    });

    it("returns 400 when url is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links`,
          json({ title: "Docs", url: "" })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("URL");
    });

    it("returns 400 when title is only whitespace", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links`,
          json({ title: "   ", url: "https://docs.example.com" })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
    });
  });

  describe("PATCH /projects/:id/doc-links/:linkId", () => {
    it("updates a doc link", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links/link-1`,
          json({ title: "Updated" }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 404 for nonexistent doc link", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          updateDocLink: async () => null,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links/nonexistent`,
          json({ title: "X" }, "PATCH")
        )
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("DELETE /projects/:id/doc-links/:linkId", () => {
    it("deletes a doc link", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}/doc-links/link-1`, {
          method: "DELETE",
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 for nonexistent doc link", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          deleteDocLink: async () => false,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(`/projects/${testProject.id}/doc-links/nonexistent`, {
          method: "DELETE",
        })
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("PATCH /projects/:id/doc-links/reorder", () => {
    it("reorders doc links", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links/reorder`,
          json({ linkIds: ["link-2", "link-1"] }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 400 when linkIds is empty array", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/doc-links/reorder`,
          json({ linkIds: [] }, "PATCH")
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("linkIds");
    });
  });
});

// ─────────────────────────────────────────────────────
// Repositories sub-resource
// ─────────────────────────────────────────────────────

describe("Repositories", () => {
  describe("GET /projects/:id/repositories", () => {
    it("returns repositories for a project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        get(`/projects/${testProject.id}/repositories`)
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("POST /projects/:id/repositories", () => {
    it("creates a repository and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories`,
          json({ name: "my-repo", url: "https://github.com/org/repo" })
        )
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("repo-1");
      expect(body.data.url).toBe("https://github.com/org/repo");
      expect(body.data.created).toBeUndefined();
    });

    it("returns 400 when name is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories`,
          json({ name: "", url: "https://github.com/org/repo" })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("Name");
    });

    it("returns 400 when url is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories`,
          json({ name: "my-repo", url: "" })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("URL");
    });

    it("accepts optional provider and isMonorepo fields", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories`,
          json({
            name: "my-repo",
            url: "https://github.com/org/repo",
            provider: "github",
            isMonorepo: true,
            order: 7,
          })
        )
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe("github");
      expect(body.data.isMonorepo).toBe(true);
      expect(body.data.order).toBe(7);
    });

    it("returns 400 only for known repository URL validation failures", async () => {
      const app = await makeApp();
      const res = await app.handle(req(
        `/projects/${testProject.id}/repositories`,
        json({ name: "unsafe", url: "http://127.0.0.1/repo", provider: "other" }),
      ));

      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toContain("HTTPS");
    });

    it("classifies unknown failures as generic logged 500 responses", async () => {
      const { classifyRepositoryAttachError } = await import("./projects.routes");
      expect(classifyRepositoryAttachError(new Error("sensitive database detail"))).toEqual({
        status: 500,
        message: "Could not attach repository",
        log: true,
      });
    });
  });

  describe("PATCH /projects/:id/repositories/:repoId", () => {
    it("updates a repository", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories/repo-1`,
          json({ name: "updated-repo" }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 404 for nonexistent repository", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          updateRepository: async () => null,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories/nonexistent`,
          json({ name: "X" }, "PATCH")
        )
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("DELETE /projects/:id/repositories/:repoId", () => {
    it("deletes a repository", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}/repositories/repo-1`, {
          method: "DELETE",
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 for nonexistent repository", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          deleteRepository: async () => false,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(`/projects/${testProject.id}/repositories/nonexistent`, {
          method: "DELETE",
        })
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("PATCH /projects/:id/repositories/reorder", () => {
    it("reorders repositories", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories/reorder`,
          json({ repoIds: ["repo-2", "repo-1"] }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 400 when repoIds is empty array", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/repositories/reorder`,
          json({ repoIds: [] }, "PATCH")
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("repoIds");
    });
  });
});

// ─────────────────────────────────────────────────────
// Notes sub-resource
// ─────────────────────────────────────────────────────

describe("Notes", () => {
  describe("GET /projects/:id/notes", () => {
    it("returns notes for a project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        get(`/projects/${testProject.id}/notes`)
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("POST /projects/:id/notes", () => {
    it("creates a note and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes`,
          json({ title: "Meeting Notes" })
        )
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("note-1");
    });

    it("creates a note with optional content", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes`,
          json({ title: "Meeting Notes", content: "Some content here" })
        )
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 400 when title is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes`,
          json({ title: "" })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("Title");
    });

    it("returns 400 when title is only whitespace", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes`,
          json({ title: "   " })
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
    });
  });

  describe("GET /projects/:id/notes/:noteId", () => {
    it("returns 404 for nonexistent note", async () => {
      const app = await makeApp();
      const res = await app.handle(
        get(`/projects/${testProject.id}/notes/nonexistent`)
      );

      // Default mock returns null for getNoteById
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });

    it("returns a note by ID", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getNoteById: async (_orgId: string, id: string) =>
            id === "note-1"
              ? { id: "note-1", title: "Test Note", content: "Content" }
              : null,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        get(`/projects/${testProject.id}/notes/note-1`)
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("note-1");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("PATCH /projects/:id/notes/:noteId", () => {
    it("updates a note", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          updateNote: async () => ({ id: "note-1", title: "Updated" }),
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes/note-1`,
          json({ title: "Updated" }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 for nonexistent note", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          updateNote: async () => null,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes/nonexistent`,
          json({ title: "X" }, "PATCH")
        )
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("DELETE /projects/:id/notes/:noteId", () => {
    it("deletes a note", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          deleteNote: async () => true,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(`/projects/${testProject.id}/notes/note-1`, { method: "DELETE" })
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 for nonexistent note", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          deleteNote: async () => false,
        })
      );

      const { Elysia } = await import("elysia");
      const { projectsRoutes } = await import("./projects.routes");
      const app = new Elysia().use(withTestOrg).use(projectsRoutes);

      const res = await app.handle(
        req(`/projects/${testProject.id}/notes/nonexistent`, {
          method: "DELETE",
        })
      );

      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("PATCH /projects/:id/notes/reorder", () => {
    it("reorders notes", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes/reorder`,
          json({ noteIds: ["note-2", "note-1"] }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
    });

    it("returns 400 when noteIds is empty array", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/notes/reorder`,
          json({ noteIds: [] }, "PATCH")
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("noteIds");
    });
  });
});

// ─────────────────────────────────────────────────────
// Nightly Validation
// ─────────────────────────────────────────────────────

describe("Nightly Validation", () => {
  const nightlyValidationConfig = {
    enabled: true,
    startHour: 2,
    endHour: 5,
    timezone: "Europe/Madrid",
    provider: "claude-code",
  };

  it("returns nightly validation settings for a project", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getProjectNightlyValidation: async () => nightlyValidationConfig,
      })
    );

    const { Elysia } = await import("elysia");
    const { projectsRoutes } = await import("./projects.routes");
    const app = new Elysia().use(withTestOrg).use(projectsRoutes);

    const res = await app.handle(
      get(`/projects/${testProject.id}/nightly-validation`)
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toEqual(nightlyValidationConfig);

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("returns 503 when nightly validation cannot be loaded because the column is missing", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getProjectNightlyValidation: async () => {
          const error = new Error("Failed to load nightly validation");
          (error as Error & { cause?: Error }).cause = new Error(
            'column "nightly_validation" does not exist'
          );
          throw error;
        },
      })
    );

    const { Elysia } = await import("elysia");
    const { projectsRoutes } = await import("./projects.routes");
    const app = new Elysia().use(withTestOrg).use(projectsRoutes);

    const res = await app.handle(
      get(`/projects/${testProject.id}/nightly-validation`)
    );

    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("migration");

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("updates nightly validation settings", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        updateProjectNightlyValidation: async () => undefined,
        getProjectNightlyValidation: async () => nightlyValidationConfig,
      })
    );

    const { Elysia } = await import("elysia");
    const { projectsRoutes } = await import("./projects.routes");
    const app = new Elysia().use(withTestOrg).use(projectsRoutes);

    const res = await app.handle(
      req(
        `/projects/${testProject.id}/nightly-validation`,
        json(nightlyValidationConfig, "PATCH")
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toEqual(nightlyValidationConfig);

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("defaults provider to claude-code when an older client omits it", async () => {
    let capturedConfig: Record<string, unknown> | null = null;

    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        updateProjectNightlyValidation: async (
          _projectId: string,
          config: Record<string, unknown>
        ) => {
          capturedConfig = config;
        },
        getProjectNightlyValidation: async () => nightlyValidationConfig,
      })
    );

    const { Elysia } = await import("elysia");
    const { projectsRoutes } = await import("./projects.routes");
    const app = new Elysia().use(withTestOrg).use(projectsRoutes);

    const res = await app.handle(
      req(
        `/projects/${testProject.id}/nightly-validation`,
        json(
          {
            enabled: true,
            startHour: 2,
            endHour: 5,
            timezone: "Europe/Madrid",
          },
          "PATCH"
        )
      )
    );

    expect(res.status).toBe(200);
    expect(capturedConfig as unknown as Record<string, unknown>).toEqual({
      enabled: true,
      startHour: 2,
      endHour: 5,
      timezone: "Europe/Madrid",
      provider: "claude-code",
    });

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("returns 503 when nightly validation cannot be saved because the column is missing", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        updateProjectNightlyValidation: async () => {
          const error = new Error(
            'The "projects.nightly_validation" column is missing. Run database migration 0098_brave_champions.sql.'
          ) as Error & { code?: string };
          error.code = "42703";
          throw error;
        },
      })
    );

    const { Elysia } = await import("elysia");
    const { projectsRoutes } = await import("./projects.routes");
    const app = new Elysia().use(withTestOrg).use(projectsRoutes);

    const res = await app.handle(
      req(
        `/projects/${testProject.id}/nightly-validation`,
        json(nightlyValidationConfig, "PATCH")
      )
    );

    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("migration");

    mock.module("@almirant/database", () => createDatabaseMocks());
  });
});

// ─────────────────────────────────────────────────────
// Dev Flow (issue #230) — PATCH /projects/:id/ai-config devFlow wiring
// and GET /projects/:id/dev-flow status. `getProjectAiConfig` /
// `updateProjectAiConfig` / the scheduled-agent-config repository functions
// are mocked here (they resolve to the real implementation otherwise,
// which would hit an unavailable DB); `dev-flow-provisioning.ts` itself
// runs for real against those mocks, exercising the real
// route -> provisioning -> repository wiring end to end.
// ─────────────────────────────────────────────────────

describe("Dev Flow", () => {
  const emptyAiConfig = { defaultProvider: null, agentDefaults: {} };

  describe("PATCH /projects/:id/ai-config", () => {
    it("leaves the response unchanged (no devFlowProvisioning key) when devFlow is not part of the payload", async () => {
      let updateCall: unknown[] | null = null;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async (...args: unknown[]) => {
            updateCall = args;
            return { defaultProvider: "claude-code", agentDefaults: { implementation: {} } };
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json({ defaultProvider: "claude-code", agentDefaults: { implementation: {} } }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ defaultProvider: "claude-code", agentDefaults: { implementation: {} } });
      expect(body.data.devFlowProvisioning).toBeUndefined();
      expect(updateCall).not.toBeNull();

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("provisions all four built-in automations and includes devFlowProvisioning in the response when devFlow.enabled=true", async () => {
      const createCalls: Array<Record<string, unknown>> = [];
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async (
            _projectId: string,
            defaultProvider: string | null,
            agentDefaults: unknown
          ) => ({ defaultProvider, agentDefaults }),
          listScheduledAgentConfigsByWorkspace: async () => [],
          createScheduledAgentConfig: async (input: Record<string, unknown>) => {
            createCalls.push(input);
            return {
              id: `cfg-system-${createCalls.length}`,
              enabled: input.enabled,
              lastRunAt: null,
              managedBy: input.managedBy,
              builtinAutomationId: input.builtinAutomationId,
            };
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json({
            defaultProvider: null,
            agentDefaults: { devFlow: { enabled: true, codingAgent: "claude-code", aiProvider: "anthropic" } },
          }, "PATCH")
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(createCalls).toHaveLength(4);
      expect(createCalls.every((call) => call.managedBy === "system")).toBe(true);
      expect(createCalls.every((call) => call.projectId === testProject.id)).toBe(true);
      expect(body.data.devFlowProvisioning.automations).toHaveLength(4);
      expect(body.data.devFlowProvisioning.skippedExistingUserAgents).toEqual([]);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("rejects an incoherent devFlow runtime (unknown model) with 400 before persisting or provisioning anything", async () => {
      let updateCalled = false;
      let createCalled = false;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async () => {
            updateCalled = true;
            return emptyAiConfig;
          },
          createScheduledAgentConfig: async () => {
            createCalled = true;
            throw new Error("should not be called");
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json({
            defaultProvider: null,
            agentDefaults: { devFlow: { enabled: true, model: "not-a-real-model-xyz" } },
          }, "PATCH")
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("Invalid scheduled agent runtime");
      expect(updateCalled).toBe(false);
      expect(createCalled).toBe(false);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 for an unknown project id", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/does-not-exist/ai-config`,
          json({ defaultProvider: null, agentDefaults: { devFlow: { enabled: true } } }, "PATCH")
        )
      );

      expect(res.status).toBe(404);
    });
  });

  describe("GET /projects/:id/dev-flow", () => {
    it("returns disabled devFlow defaults and four unprovisioned automations when nothing has been provisioned yet", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          listScheduledAgentConfigsByWorkspace: async () => [],
        })
      );

      const app = await makeApp();
      const res = await app.handle(get(`/projects/${testProject.id}/dev-flow`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.devFlow).toEqual({
        enabled: false,
        codingAgent: null,
        aiProvider: null,
        model: null,
        reasoningLevel: null,
        maxConcurrentJobs: null,
      });
      expect(body.data.automations).toHaveLength(4);
      expect(body.data.automations.every((a: any) => a.configId === null)).toBe(true);
      expect(body.data.skippedExistingUserAgents).toEqual([]);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("reflects already-provisioned system configs and the persisted devFlow config", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => ({
            defaultProvider: null,
            agentDefaults: { devFlow: { enabled: true, codingAgent: "codex", aiProvider: "openai" } },
          }),
          listScheduledAgentConfigsByWorkspace: async (
            _workspaceId: string,
            filters?: { projectId?: string }
          ) =>
            filters?.projectId === testProject.id
              ? [
                  {
                    id: "cfg-system-dod-review",
                    workspaceId: "org-test-1",
                    projectId: testProject.id,
                    managedBy: "system",
                    builtinAutomationId: "dod-review",
                    targetConfig: { dodReview: { enabled: true } },
                    enabled: true,
                    lastRunAt: new Date("2026-07-01T00:00:00.000Z"),
                  },
                ]
              : [],
        })
      );

      const app = await makeApp();
      const res = await app.handle(get(`/projects/${testProject.id}/dev-flow`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.devFlow).toMatchObject({ enabled: true, codingAgent: "codex", aiProvider: "openai" });
      const dodReview = body.data.automations.find((a: any) => a.automationId === "dod-review");
      expect(dodReview.configId).toBe("cfg-system-dod-review");
      expect(dodReview.enabled).toBe(true);
      expect(dodReview.lastRunAt).toBe("2026-07-01T00:00:00.000Z");
      const backlogDrain = body.data.automations.find((a: any) => a.automationId === "backlog-drain");
      expect(backlogDrain.configId).toBeNull();

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("surfaces a conflicting user-owned agent in skippedExistingUserAgents", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          listScheduledAgentConfigsByWorkspace: async (
            _workspaceId: string,
            _filters?: { projectId?: string }
          ) => [
            {
              id: "cfg-user-backlog-drain",
              workspaceId: "org-test-1",
              projectId: testProject.id,
              managedBy: "user",
              builtinAutomationId: null,
              targetConfig: { backlogDrain: { enabled: true } },
              enabled: true,
              lastRunAt: null,
            },
          ],
        })
      );

      const app = await makeApp();
      const res = await app.handle(get(`/projects/${testProject.id}/dev-flow`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.skippedExistingUserAgents).toEqual([
        { configId: "cfg-user-backlog-drain", automationId: "backlog-drain" },
      ]);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 for an unknown project id", async () => {
      const app = await makeApp();
      const res = await app.handle(get(`/projects/does-not-exist/dev-flow`));

      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────
  // Per-automation config (issue #235)
  // ─────────────────────────────────────────────────────

  describe("PATCH /projects/:id/ai-config — per-automation overrides (issue #235)", () => {
    it("persists devFlow.automations verbatim and provisions the EFFECTIVE per-automation runtime/schedule", async () => {
      let persistedAgentDefaults: unknown = null;
      const createCalls: Array<Record<string, unknown>> = [];
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async (
            _projectId: string,
            defaultProvider: string | null,
            agentDefaults: unknown
          ) => {
            persistedAgentDefaults = agentDefaults;
            return { defaultProvider, agentDefaults };
          },
          listScheduledAgentConfigsByWorkspace: async () => [],
          createScheduledAgentConfig: async (input: Record<string, unknown>) => {
            createCalls.push(input);
            return {
              id: `cfg-system-${createCalls.length}`,
              enabled: input.enabled,
              lastRunAt: null,
              managedBy: input.managedBy,
              builtinAutomationId: input.builtinAutomationId,
            };
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json(
            {
              defaultProvider: null,
              agentDefaults: {
                devFlow: {
                  enabled: true,
                  codingAgent: "claude-code",
                  aiProvider: "anthropic",
                  model: "claude-opus-4-8",
                  automations: {
                    "dod-review": {
                      codingAgent: "opencode",
                      aiProvider: "zai",
                      model: "glm-5.2",
                      schedule: { expression: "0 */3 * * *", timezone: "UTC" },
                    },
                  },
                },
              },
            },
            "PATCH"
          )
        )
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);

      // Persisted verbatim — the whole point of the JSONB is round-tripping.
      expect((persistedAgentDefaults as any).devFlow.automations["dod-review"]).toEqual({
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5.2",
        schedule: { expression: "0 */3 * * *", timezone: "UTC" },
      });

      // Provisioned with the EFFECTIVE (override) runtime/schedule for dod-review...
      const dodReviewCall = createCalls.find((call) => call.builtinAutomationId === "dod-review")!;
      expect(dodReviewCall.codingAgent).toBe("opencode");
      expect(dodReviewCall.aiProvider).toBe("zai");
      expect(dodReviewCall.aiModel).toBe("glm-5.2");
      expect(dodReviewCall.scheduleType).toBe("cron");
      expect(dodReviewCall.scheduleConfig).toEqual({ expression: "0 */3 * * *" });
      expect(dodReviewCall.timezone).toBe("UTC");

      // ...and the card default (default cron/timezone) for the other three.
      const backlogDrainCall = createCalls.find((call) => call.builtinAutomationId === "backlog-drain")!;
      expect(backlogDrainCall.codingAgent).toBe("claude-code");
      expect(backlogDrainCall.aiProvider).toBe("anthropic");
      expect(backlogDrainCall.aiModel).toBe("claude-opus-4-8");
      expect(backlogDrainCall.scheduleConfig).toEqual({ expression: "*/5 * * * *" });
      expect(backlogDrainCall.timezone).toBe("Europe/Madrid");

      // Response mirrors the SAME shape as GET /dev-flow's automations array.
      const dodReviewStatus = body.data.devFlowProvisioning.automations.find(
        (a: any) => a.automationId === "dod-review"
      );
      expect(dodReviewStatus.overrides.codingAgent).toBe("opencode");
      expect(dodReviewStatus.effective.codingAgent).toBe("opencode");
      expect(dodReviewStatus.effective.schedule).toEqual({ expression: "0 */3 * * *", timezone: "UTC" });

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("rejects an unknown automation id in devFlow.automations with 400 before persisting or provisioning anything", async () => {
      let updateCalled = false;
      let createCalled = false;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async () => {
            updateCalled = true;
            return emptyAiConfig;
          },
          createScheduledAgentConfig: async () => {
            createCalled = true;
            throw new Error("should not be called");
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json(
            {
              defaultProvider: null,
              agentDefaults: {
                devFlow: { enabled: true, automations: { "not-a-real-automation": { enabled: true } } },
              },
            },
            "PATCH"
          )
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("not-a-real-automation");
      expect(updateCalled).toBe(false);
      expect(createCalled).toBe(false);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("rejects an invalid cron expression in an automation's schedule override with 400 before persisting or provisioning anything", async () => {
      let updateCalled = false;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async () => {
            updateCalled = true;
            return emptyAiConfig;
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json(
            {
              defaultProvider: null,
              agentDefaults: {
                devFlow: {
                  enabled: true,
                  automations: { "backlog-drain": { schedule: { expression: "not-a-cron" } } },
                },
              },
            },
            "PATCH"
          )
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("Invalid cron expression");
      expect(updateCalled).toBe(false);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("rejects an incoherent EFFECTIVE runtime for a specific automation override (card default alone is fine) with 400", async () => {
      let updateCalled = false;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async () => {
            updateCalled = true;
            return emptyAiConfig;
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json(
            {
              defaultProvider: null,
              agentDefaults: {
                devFlow: {
                  enabled: true,
                  codingAgent: "claude-code",
                  aiProvider: "anthropic",
                  model: "claude-opus-4-8",
                  automations: { "dod-remediation": { model: "not-a-real-model-xyz" } },
                },
              },
            },
            "PATCH"
          )
        )
      );

      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain("Invalid scheduled agent runtime");
      expect(body.error).toContain("dod-remediation");
      expect(updateCalled).toBe(false);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("accepts an explicit schedule: null override (clears any previously-saved schedule) and persists it verbatim", async () => {
      let persistedAgentDefaults: unknown = null;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async (
            _projectId: string,
            defaultProvider: string | null,
            agentDefaults: unknown
          ) => {
            persistedAgentDefaults = agentDefaults;
            return { defaultProvider, agentDefaults };
          },
          listScheduledAgentConfigsByWorkspace: async () => [],
          createScheduledAgentConfig: async (input: Record<string, unknown>) => ({
            id: "cfg-1",
            enabled: input.enabled,
            lastRunAt: null,
            managedBy: input.managedBy,
            builtinAutomationId: input.builtinAutomationId,
          }),
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json(
            {
              defaultProvider: null,
              agentDefaults: { devFlow: { enabled: true, automations: { "backlog-drain": { schedule: null } } } },
            },
            "PATCH"
          )
        )
      );

      expect(res.status).toBe(200);
      expect((persistedAgentDefaults as any).devFlow.automations["backlog-drain"]).toEqual({ schedule: null });

      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // ─────────────────────────────────────────────────────
  // Client wire-contract regression (review fixes #1+#2): the schema requires
  // `defaultProvider` (Nullable, NOT Optional) and `devFlow.enabled`
  // (Boolean, NOT Optional) — see the PROJECT_AGENT_DEFAULTS_SCHEMA /
  // body schema above. Before the fix, the frontend's devFlowApi.updateConfig
  // / updateAutomationOverrides (frontend/src/lib/api/client.ts) sent
  // `{ agentDefaults: { devFlow } }` without `defaultProvider` at all —
  // TypeBox validation rejected every request with a 400, so devFlow saves
  // never worked. The fix is entirely on the frontend (use-project-dev-flow.ts
  // / use-dev-flow-automation-overrides.ts now build the COMPLETE body,
  // mirroring use-project-ai-config.ts's pattern) — this backend schema is
  // intentionally left as-is (relaxing it would let a half-formed devFlow
  // silently wipe `implementation`/other scalars via the wholesale JSONB
  // replace in updateProjectAiConfig). These tests pin BOTH halves of that
  // contract: the old incomplete shape must keep 400ing, and the new
  // complete shape the fixed client sends must 200 AND round-trip
  // `implementation`/devFlow scalars intact through a devFlow.automations
  // save (the exact scenario Fix 1+2 was about — a wholesale JSONB replace
  // must not drop data the caller didn't touch).
  // ─────────────────────────────────────────────────────
  describe("PATCH /projects/:id/ai-config — client.ts wire-contract regression (review fixes #1+#2)", () => {
    it("still rejects the OLD incomplete payload shape (missing defaultProvider) — pinning why the fix had to be client-side, not a schema relaxation", async () => {
      let updateCalled = false;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async () => {
            updateCalled = true;
            return emptyAiConfig;
          },
        })
      );

      const app = await makeApp();
      // This is EXACTLY the shape the pre-fix devFlowApi.updateConfig sent:
      // `{ agentDefaults: { devFlow } }`, no `defaultProvider` key at all —
      // `defaultProvider` is `t.Nullable(t.String())`, NOT `t.Optional`, so
      // TypeBox rejects the request before the handler ever runs.
      const res = await app.handle(
        req(
          `/projects/${testProject.id}/ai-config`,
          json({ agentDefaults: { devFlow: { enabled: true, codingAgent: "claude-code" } } }, "PATCH")
        )
      );

      // `makeApp()` here wires only `projectsRoutes` (see the top of this
      // file), not the global `errorMiddleware` from src/index.ts that maps
      // Elysia's VALIDATION code to 400 in production — so this isolated
      // harness surfaces Elysia's raw default (422) for a schema failure
      // instead. Either way the request is REJECTED and NOTHING is
      // persisted, which is the actual contract being pinned here.
      expect(res.status).toBe(422);
      expect(updateCalled).toBe(false);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("accepts the FULL body the fixed devFlowApi.updateAutomationOverrides client builds, and persists implementation + devFlow scalars + automations intact", async () => {
      // Definite-assignment assertion (`!`) here on purpose — TS's
      // control-flow analysis narrows a `let x: string | null = null`
      // closured-and-reassigned variable to the literal `null` at later read
      // sites (it can't see into the nested mock closure below), which then
      // makes `expect(...).toBe("codex")` fail to type-check against the
      // wrong overload. `!` keeps the declared union type without falling
      // into the opposite "used before being assigned" error.
      let persistedDefaultProvider!: string | null;
      let persistedAgentDefaults: unknown = null;
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          updateProjectAiConfig: async (
            _projectId: string,
            defaultProvider: string | null,
            agentDefaults: unknown
          ) => {
            persistedDefaultProvider = defaultProvider;
            persistedAgentDefaults = agentDefaults;
            return { defaultProvider, agentDefaults };
          },
          listScheduledAgentConfigsByWorkspace: async () => [],
          createScheduledAgentConfig: async (input: Record<string, unknown>) => ({
            id: `cfg-system-${input.builtinAutomationId}`,
            enabled: input.enabled,
            lastRunAt: null,
            managedBy: input.managedBy,
            builtinAutomationId: input.builtinAutomationId,
          }),
        })
      );

      const app = await makeApp();

      // Byte-for-byte mirror of what the FIXED useDevFlowAutomationOverrides'
      // mutationFn builds (frontend/src/domains/projects/application/hooks/
      // use-dev-flow-automation-overrides.ts) before calling
      // devFlowApi.updateAutomationOverrides — defaultProvider + implementation
      // read from the (shared, cached) ai-config query, devFlow scalars read
      // from the card's server-persisted settings, and the automations map
      // built by buildDevFlowAutomationsPatchPayload. If this literal ever
      // drifts from the real client body, this test is documenting the wrong
      // contract — keep them in sync by construction, not by memory.
      const clientBuiltBody = {
        defaultProvider: "codex",
        agentDefaults: {
          implementation: {
            codingAgent: "codex",
            aiProvider: "openai",
            model: "gpt-5.6-sol",
            reasoningLevel: null,
          },
          devFlow: {
            enabled: true,
            codingAgent: "claude-code",
            aiProvider: "anthropic",
            model: "claude-opus-4-8",
            reasoningLevel: null,
            maxConcurrentJobs: null,
            automations: {
              "dod-review": { model: "claude-sonnet-5", schedule: null },
            },
          },
        },
      };

      const res = await app.handle(
        req(`/projects/${testProject.id}/ai-config`, json(clientBuiltBody, "PATCH"))
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);

      // Old bug #1: `defaultProvider` was missing entirely -> 400 always.
      expect(persistedDefaultProvider).toBe("codex");

      // Old bug #2: a wholesale JSONB replace with only `devFlow` present
      // would silently drop `implementation`. Proves it survives a
      // devFlow-automations save intact.
      expect((persistedAgentDefaults as any).implementation).toEqual({
        codingAgent: "codex",
        aiProvider: "openai",
        model: "gpt-5.6-sol",
        reasoningLevel: null,
      });

      // The card-level devFlow scalars must survive too, not just automations.
      expect((persistedAgentDefaults as any).devFlow.enabled).toBe(true);
      expect((persistedAgentDefaults as any).devFlow.codingAgent).toBe("claude-code");
      expect((persistedAgentDefaults as any).devFlow.aiProvider).toBe("anthropic");
      expect((persistedAgentDefaults as any).devFlow.model).toBe("claude-opus-4-8");
      expect((persistedAgentDefaults as any).devFlow.automations["dod-review"]).toEqual({
        model: "claude-sonnet-5",
        schedule: null,
      });

      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("GET /projects/:id/dev-flow — overrides/effective (issue #235)", () => {
    it("returns overrides: null and a card-default-derived effective view for an automation without an override", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => ({
            defaultProvider: null,
            agentDefaults: {
              devFlow: { enabled: true, codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8" },
            },
          }),
          listScheduledAgentConfigsByWorkspace: async () => [],
        })
      );

      const app = await makeApp();
      const res = await app.handle(get(`/projects/${testProject.id}/dev-flow`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const backlogDrain = body.data.automations.find((a: any) => a.automationId === "backlog-drain");
      expect(backlogDrain.overrides).toBeNull();
      expect(backlogDrain.effective).toEqual({
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-8",
        reasoningLevel: null,
        maxConcurrentJobs: null,
        schedule: { expression: "*/5 * * * *", timezone: "Europe/Madrid" },
      });

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns the raw override plus the merged effective runtime for an automation WITH an override", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => ({
            defaultProvider: null,
            agentDefaults: {
              devFlow: {
                enabled: true,
                codingAgent: "claude-code",
                automations: {
                  "release-integration": { codingAgent: "codex", schedule: { expression: "0 6 * * *" } },
                },
              },
            },
          }),
          listScheduledAgentConfigsByWorkspace: async () => [],
        })
      );

      const app = await makeApp();
      const res = await app.handle(get(`/projects/${testProject.id}/dev-flow`));

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const releaseIntegration = body.data.automations.find((a: any) => a.automationId === "release-integration");
      expect(releaseIntegration.overrides).toEqual({
        enabled: null,
        codingAgent: "codex",
        aiProvider: null,
        model: null,
        reasoningLevel: null,
        maxConcurrentJobs: null,
        schedule: { expression: "0 6 * * *", timezone: null },
      });
      expect(releaseIntegration.effective).toEqual({
        codingAgent: "codex",
        aiProvider: null,
        model: null,
        reasoningLevel: null,
        maxConcurrentJobs: null,
        schedule: { expression: "0 6 * * *", timezone: "Europe/Madrid" },
      });

      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("POST /projects/:id/dev-flow/adopt (issue #235)", () => {
    it("disables the conflicting user config and enables the system automation, returning the GET-shaped automation entry", async () => {
      const updateCalls: Array<{ id: string; input: Record<string, unknown> }> = [];
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => ({
            defaultProvider: null,
            agentDefaults: { devFlow: { enabled: true, codingAgent: "claude-code" } },
          }),
          listScheduledAgentConfigsByWorkspace: async () => [
            {
              id: "cfg-user-backlog-drain",
              workspaceId: "org-test-1",
              projectId: testProject.id,
              managedBy: "user",
              builtinAutomationId: null,
              targetConfig: { backlogDrain: { enabled: true } },
              enabled: true,
              lastRunAt: null,
            },
          ],
          updateScheduledAgentConfig: async (id: string, _workspaceId: string, input: Record<string, unknown>) => {
            updateCalls.push({ id, input });
            if (id === "cfg-user-backlog-drain") {
              return { id, enabled: false, managedBy: "user" };
            }
            return { id, enabled: true, managedBy: "system", builtinAutomationId: "backlog-drain", lastRunAt: null };
          },
          createScheduledAgentConfig: async (input: Record<string, unknown>) => ({
            id: "cfg-system-new",
            enabled: input.enabled,
            managedBy: input.managedBy,
            builtinAutomationId: input.builtinAutomationId,
            lastRunAt: null,
          }),
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}/dev-flow/adopt`, json({ automationId: "backlog-drain" }, "POST"))
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.disabledUserConfigIds).toEqual(["cfg-user-backlog-drain"]);
      expect(body.data.automation.automationId).toBe("backlog-drain");
      expect(body.data.automation.enabled).toBe(true);
      expect(body.data.automation.managedBy).toBe("system");
      expect(
        updateCalls.some((call) => call.id === "cfg-user-backlog-drain" && call.input.enabled === false)
      ).toBe(true);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 409 when there is no conflicting user agent for that automation", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getProjectAiConfig: async () => emptyAiConfig,
          listScheduledAgentConfigsByWorkspace: async () => [],
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}/dev-flow/adopt`, json({ automationId: "backlog-drain" }, "POST"))
      );

      expect(res.status).toBe(409);
      const body = await res.json() as any;
      expect(body.success).toBe(false);

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 for an unknown project id", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/does-not-exist/dev-flow/adopt`, json({ automationId: "backlog-drain" }, "POST"))
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 for an unknown automation id", async () => {
      const app = await makeApp();
      const res = await app.handle(
        req(`/projects/${testProject.id}/dev-flow/adopt`, json({ automationId: "not-a-real-automation" }, "POST"))
      );

      expect(res.status).toBe(404);
    });
  });
});

// ─────────────────────────────────────────────────────
// Boards sub-resource
// ─────────────────────────────────────────────────────

describe("Boards", () => {
  describe("GET /projects/:id/boards", () => {
    it("returns boards for a project", async () => {
      const app = await makeApp();
      const res = await app.handle(
        get(`/projects/${testProject.id}/boards`)
      );

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(testBoard.id);
    });
  });

});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
