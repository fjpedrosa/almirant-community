import { describe, expect, it } from "bun:test";
import {
  buildTranscriptSegments,
  mergeTranscriptChunks,
  serializeTranscriptChunks,
} from "../utils/session-transcript-stream-utils";

describe("mergeTranscriptChunks", () => {
  it("deduplica secuencias REST y WS conservando el contentType del WS", () => {
    const merged = mergeTranscriptChunks(
      [
        { seq: 1, message: "Hola" },
        { seq: 2, message: "Mundo" },
      ],
      [
        { seq: 2, message: "Mundo", contentType: "text" },
        { seq: 3, message: "Pensando", contentType: "thinking" },
      ],
    );

    expect(merged).toEqual([
      { seq: 1, message: "Hola" },
      { seq: 2, message: "Mundo", contentType: "text" },
      { seq: 3, message: "Pensando", contentType: "thinking" },
    ]);
  });
});

describe("serializeTranscriptChunks", () => {
  it("usa la lista fusionada como fuente canonica del transcript", () => {
    const transcript = serializeTranscriptChunks(
      [
        { seq: 1, message: "Hola" },
        { seq: 2, message: "Mundo" },
      ],
      "Hola\nMundo\nMundo",
    );

    expect(transcript).toBe("Hola\nMundo");
  });

  it("mantiene el fallback cuando el backend antiguo no devuelve chunks", () => {
    expect(serializeTranscriptChunks([], "Transcript legado")).toBe(
      "Transcript legado",
    );
  });
});

describe("buildTranscriptSegments", () => {
  it("agrupa chunks consecutivos sin duplicar el snapshot REST", () => {
    const segments = buildTranscriptSegments(
      [
        { seq: 1, message: "Paso 1", contentType: "text" },
        { seq: 2, message: "Paso 2", contentType: "text" },
        { seq: 3, message: "Razonando", contentType: "thinking" },
      ],
      "Paso 1\nPaso 2",
    );

    expect(segments).toEqual([
      { contentType: "text", content: "Paso 1\nPaso 2" },
      { contentType: "thinking", content: "Razonando" },
    ]);
  });
});
