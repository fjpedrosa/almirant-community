import { Elysia } from "elysia";
import { createNotesRoutes } from "./routes/notes.routes";
import { notesService, type NotesService } from "./services/notes.service";

export const createNotesModule = (service: NotesService = notesService) => ({
  /** Protected Notes routes mounted after authenticated workspace context. */
  protected: () => new Elysia().use(createNotesRoutes(service)),
});

export const notesModule = createNotesModule();
