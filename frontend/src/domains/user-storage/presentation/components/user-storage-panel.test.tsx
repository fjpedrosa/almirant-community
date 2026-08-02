import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Window } from "happy-dom";
import { UserStoragePanel } from "./user-storage-panel";
import type { UserStorageFile, UserStorageUsage } from "../../domain/types";

// React Testing Library's userEvent.upload performs instanceof checks against
// concrete DOM constructors that happy-dom does not expose globally by default.
const happyWindow = new Window();
for (const name of ["NodeFilter", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement"] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
    (globalThis as Record<string, unknown>)[name] = (happyWindow as unknown as Record<string, unknown>)[name];
  }
}

const usage: UserStorageUsage = {
  quotaBytes: 1_073_741_824,
  usedBytes: 268_435_456,
  reservedBytes: 0,
  quotaObjects: 10_000,
  usedObjects: 1,
  reservedObjects: 0,
  availableObjects: 9_999,
  updatedAt: "2026-07-10T10:00:00.000Z",
};

const file: UserStorageFile = {
  id: "file-1",
  virtualPath: "research/notes.txt",
  fileName: "notes.txt",
  contentType: "text/plain",
  sizeBytes: 1_024,
  kind: "file",
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
};

const renderPanel = (overrides: Partial<React.ComponentProps<typeof UserStoragePanel>> = {}) => {
  const props: React.ComponentProps<typeof UserStoragePanel> = {
    usage,
    files: [file],
    isLoading: false,
    isUploading: false,
    deletingFileId: null,
    downloadingFileId: null,
    errorMessage: null,
    onUpload: mock(async () => undefined),
    onDownload: mock(async () => undefined),
    onDelete: mock(async () => undefined),
    ...overrides,
  };
  return { ...render(<UserStoragePanel {...props} />), props };
};

describe("UserStoragePanel", () => {
  it("shows quota and user-owned files", () => {
    renderPanel();

    expect(screen.getByRole("heading", { name: "Storage" })).toBeInTheDocument();
    expect(screen.getByText("256 MB used of 1 GB")).toBeInTheDocument();
    expect(screen.getByText("1 of 10,000 files used.")).toBeInTheDocument();
    expect(screen.getByText("research/notes.txt")).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
  });

  it("uploads the selected file at an optional virtual path", async () => {
    const onUpload = mock(async () => undefined);
    renderPanel({ onUpload });
    const selectedFile = new File(["contents"], "report.txt", {
      type: "text/plain",
    });

    await userEvent.upload(screen.getByLabelText("File"), selectedFile);
    await userEvent.type(
      screen.getByLabelText("Virtual path (optional)"),
      "reports/weekly.txt",
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload file" }));

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith({
        file: selectedFile,
        path: "reports/weekly.txt",
      });
    });
  });

  it("keeps the selected file and path when an upload fails", async () => {
    const onUpload = mock(async () => false);
    renderPanel({ onUpload });
    const selectedFile = new File(["contents"], "report.txt", {
      type: "text/plain",
    });
    const fileInput = screen.getByLabelText("File") as HTMLInputElement;
    const pathInput = screen.getByLabelText("Virtual path (optional)");

    await userEvent.upload(fileInput, selectedFile);
    await userEvent.type(pathInput, "reports/weekly.txt");
    await userEvent.click(screen.getByRole("button", { name: "Upload file" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(fileInput.files?.item(0)).toBe(selectedFile);
    expect(pathInput).toHaveValue("reports/weekly.txt");
  });

  it("downloads a file and confirms destructive deletion", async () => {
    const onDownload = mock(async () => undefined);
    const onDelete = mock(async () => undefined);
    renderPanel({ onDownload, onDelete });

    await userEvent.click(
      screen.getByRole("button", { name: "Download research/notes.txt" }),
    );
    expect(onDownload).toHaveBeenCalledWith(file);

    fireEvent.click(
      screen.getByRole("button", { name: "Delete research/notes.txt" }),
    );
    expect(
      await screen.findByText("Delete research/notes.txt?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));

    expect(onDelete).toHaveBeenCalledWith(file);
  });

  it("renders loading, empty and error states", () => {
    const { rerender, props } = renderPanel({
      usage: undefined,
      files: [],
      isLoading: true,
    });
    expect(screen.getAllByText("Loading storage...")).toHaveLength(2);

    rerender(
      <UserStoragePanel
        {...props}
        isLoading={false}
        files={[]}
        errorMessage="Storage is unavailable"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Storage is unavailable");
    expect(screen.getByText("No files yet")).toBeInTheDocument();
  });
});
