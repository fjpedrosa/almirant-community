import { afterEach, describe, expect, it, mock } from "bun:test";
import { saveDownloadedFile } from "./save-downloaded-file";

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
});

describe("saveDownloadedFile", () => {
  it("downloads with a sanitized basename and revokes the object URL", () => {
    const createObjectURL = mock(() => "blob:storage-file");
    const revokeObjectURL = mock(() => undefined);
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const click = mock(() => undefined);
    const anchor = document.createElement("a");
    anchor.click = click;
    const createElement = document.createElement.bind(document);
    const createElementMock = mock((tagName: string) =>
      tagName === "a" ? anchor : createElement(tagName),
    );
    document.createElement = createElementMock as typeof document.createElement;

    saveDownloadedFile(new Blob(["notes"]), "../private/notes\u0000.txt");

    expect(anchor.download).toBe("notes.txt");
    expect(anchor.href).toBe("blob:storage-file");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:storage-file");

    document.createElement = createElement;
  });
});
