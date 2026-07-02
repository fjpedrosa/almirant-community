import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getImportJobs,
  getImportJobById,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";

// Import service functions - will be wired up when import-service lib is created
// import { previewCsv, processImport } from "../lib/import-service";

export const importsRoutes = new Elysia({ prefix: "/imports" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /imports - List all import jobs
  // -------------------------------------------------------
  .get("/", async ({ activeWorkspace }) => {
    try {
      const orgId = activeWorkspace!.id;
      const jobs = await getImportJobs(orgId);
      return successResponse(jobs);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Failed to fetch import jobs",
        500
      );
    }
  })

  // -------------------------------------------------------
  // POST /imports/preview - Preview CSV file
  // Note: This route must be registered before /:id to avoid
  //       "preview" being captured as a dynamic parameter.
  // -------------------------------------------------------
  .post(
    "/preview",
    async ({ set, request }) => {
      try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
          set.status = 400;
          return errorResponse("File is required");
        }

        if (!file.name.endsWith(".csv")) {
          set.status = 400;
          return errorResponse("Only CSV files are supported");
        }

        const text = await file.text();

        // Parse CSV using basic splitting (Papa Parse can be added as a dependency later)
        const lines = text.split("\n").filter((line) => line.trim() !== "");

        if (lines.length === 0) {
          set.status = 400;
          return errorResponse("CSV has no content");
        }

        const headers = lines[0]!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

        if (headers.length === 0) {
          set.status = 400;
          return errorResponse("CSV has no headers");
        }

        const dataRows = lines.slice(1);

        if (dataRows.length === 0) {
          set.status = 400;
          return errorResponse("CSV has no data rows");
        }

        // Build sample row objects
        const rows: Record<string, string>[] = dataRows.map((line) => {
          const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
          const row: Record<string, string> = {};
          headers.forEach((header, i) => {
            row[header] = values[i] || "";
          });
          return row;
        });

        // Suggest column mapping based on header names
        const fieldPatterns: Record<string, RegExp[]> = {
          name: [/^name$/i, /^full\s*name$/i, /^nombre$/i],
          email: [/^email$/i, /^e-mail$/i, /^correo$/i],
          phone: [/^phone$/i, /^tel$/i, /^telephone$/i, /^mobile$/i, /^telefono$/i],
          company: [/^company$/i, /^empresa$/i, /^workspace$/i],
          position: [/^position$/i, /^title$/i, /^job\s*title$/i, /^cargo$/i, /^puesto$/i],
          source: [/^source$/i, /^origen$/i, /^from$/i],
          profileUrl: [/^profile$/i, /^url$/i, /^linkedin$/i, /^link$/i],
          notes: [/^notes$/i, /^notas$/i, /^comments$/i],
        };

        const suggestedMapping: Record<string, string | null> = {};

        headers.forEach((header) => {
          let matched = false;
          for (const [field, regexes] of Object.entries(fieldPatterns)) {
            if (regexes.some((regex) => regex.test(header))) {
              suggestedMapping[header] = field;
              matched = true;
              break;
            }
          }
          if (!matched) {
            suggestedMapping[header] = null;
          }
        });

        // TODO: Replace with previewCsv from "../lib/import-service" once created
        return successResponse({
          headers,
          sampleRows: rows.slice(0, 5),
          totalRows: rows.length,
          suggestedMapping,
        });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to preview CSV",
          500
        );
      }
    }
  )

  // -------------------------------------------------------
  // POST /imports - Start import
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, set }) => {
      try {
        if (!body.fileName) {
          set.status = 400;
          return errorResponse("fileName is required");
        }

        if (!body.columnMapping || Object.keys(body.columnMapping).length === 0) {
          set.status = 400;
          return errorResponse("columnMapping is required");
        }

        if (!body.data || body.data.length === 0) {
          set.status = 400;
          return errorResponse("data is required");
        }

        // Check that name field is mapped
        const hasNameMapping = Object.values(body.columnMapping).includes("name");
        if (!hasNameMapping) {
          set.status = 400;
          return errorResponse("Name field must be mapped");
        }

        // TODO: Replace with processImport from "../lib/import-service" once created
        // const job = await processImport(
        //   body.fileName,
        //   body.columnMapping,
        //   body.data,
        //   body.funnelId,
        //   body.tagIds
        // );

        set.status = 501;
        return errorResponse(
          "Import processing not yet implemented in Elysia backend. Wire up import-service.",
          501
        );
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to start import",
          500
        );
      }
    },
    {
      body: t.Object({
        fileName: t.String(),
        columnMapping: t.Record(t.String(), t.Nullable(t.String())),
        data: t.Array(t.Record(t.String(), t.String())),
        tagIds: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /imports/:id - Get import job by ID with progress
  // -------------------------------------------------------
  .get(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const job = await getImportJobById(orgId, params.id);

        if (!job) {
          set.status = 404;
          return notFoundResponse("Import job");
        }

        const totalRows = job.totalRows ?? 0;
        const processedRows = job.processedRows ?? 0;

        return successResponse({
          ...job,
          progress: totalRows > 0 ? Math.round((processedRows / totalRows) * 100) : 0,
        });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch import job",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
