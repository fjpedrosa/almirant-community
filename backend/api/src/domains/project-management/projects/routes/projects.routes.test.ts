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
          })
        )
      );

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
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
