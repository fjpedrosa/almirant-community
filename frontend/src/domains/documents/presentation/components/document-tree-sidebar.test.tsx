import { describe, expect, it, mock } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import type {
  DocumentTreeFile,
  DocumentTreeFolder,
  DocumentTreeSidebarProps,
} from "../../domain/types";

// Radix UI Tooltip requires a Provider; wrap the component so the Tooltip root
// has the context it needs without triggering pointer-event delays in tests.
const TooltipProviderWrapper = ({ children }: { children: React.ReactNode }) => {
  const { TooltipProvider } = require("@/components/ui/tooltip");
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
};

// --- Factories ---

const createFile = (overrides: Partial<DocumentTreeFile> = {}): DocumentTreeFile => ({
  type: "file",
  id: "file-1",
  title: "My Document",
  categoryId: null,
  categoryName: null,
  categoryColor: null,
  categoryIcon: null,
  projectId: null,
  projectName: null,
  projectColor: null,
  updatedAt: new Date("2025-01-01"),
  wordCount: 100,
  isRecent: false,
  isRead: true,
  isFavorited: false,
  ...overrides,
});

const createFolder = (overrides: Partial<DocumentTreeFolder> = {}): DocumentTreeFolder => ({
  type: "folder",
  id: "folder-1",
  name: "My Folder",
  color: "#3b82f6",
  icon: null,
  depth: 0,
  totalDocumentCount: 3,
  recentCount: 1,
  unreadCount: 0,
  children: [],
  ...overrides,
});

const defaultProps: DocumentTreeSidebarProps = {
  tree: [],
  selectedDocumentId: null,
  expandedFolders: new Set<string>(),
  onToggleFolder: mock(() => {}),
  onSelectDocument: mock(() => {}),
  onToggleFavorite: mock(() => {}),
  isLoading: false,
};

const renderSidebar = (propsOverride: Partial<DocumentTreeSidebarProps> = {}) => {
  const { DocumentTreeSidebar } = require("./document-tree-sidebar");
  return render(
    <TooltipProviderWrapper>
      <DocumentTreeSidebar {...defaultProps} {...propsOverride} />
    </TooltipProviderWrapper>,
  );
};

// --- Tests ---

describe("DocumentTreeSidebar", () => {
  describe("Loading state", () => {
    it("renders a spinner when isLoading is true", () => {
      renderSidebar({ isLoading: true });

      // Loader2 from lucide-react renders an SVG with the animate-spin class
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
    });
  });

  describe("Empty state", () => {
    it('renders "No documents found" when tree is empty and not loading', () => {
      renderSidebar({ tree: [], isLoading: false });

      expect(screen.getByText("No documents found")).toBeInTheDocument();
    });
  });

  describe("Folder rendering", () => {
    it("renders the folder name", () => {
      const folder = createFolder({ name: "Engineering Docs" });
      renderSidebar({ tree: [folder] });

      expect(screen.getByText("Engineering Docs")).toBeInTheDocument();
    });

    it("applies min-w-0 class to the folder name span", () => {
      const folder = createFolder({ name: "Design System" });
      renderSidebar({ tree: [folder] });

      const nameElement = screen.getByText("Design System");
      expect(nameElement.classList.contains("min-w-0")).toBe(true);
    });

    it("applies min-w-0 and truncate classes to folder names with long text", () => {
      const longName = "A very long folder name that could easily overflow the sidebar panel width";
      const folder = createFolder({ name: longName });
      renderSidebar({ tree: [folder] });

      const nameElement = screen.getByText(longName);
      expect(nameElement.classList.contains("min-w-0")).toBe(true);
      expect(nameElement.classList.contains("truncate")).toBe(true);
    });

    it("applies min-w-0 class to folder names with short text", () => {
      const folder = createFolder({ name: "API" });
      renderSidebar({ tree: [folder] });

      const nameElement = screen.getByText("API");
      expect(nameElement.classList.contains("min-w-0")).toBe(true);
    });

    it("shows the total document count badge", () => {
      const folder = createFolder({ totalDocumentCount: 7 });
      renderSidebar({ tree: [folder] });

      expect(screen.getByText("7")).toBeInTheDocument();
    });

    it("shows unread count badge when unreadCount > 0", () => {
      const folder = createFolder({ unreadCount: 3, totalDocumentCount: 10 });
      renderSidebar({ tree: [folder] });

      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  describe("File rendering", () => {
    it("renders the file title", () => {
      const file = createFile({ title: "Getting Started Guide" });
      renderSidebar({ tree: [file] });

      expect(screen.getByText("Getting Started Guide")).toBeInTheDocument();
    });

    it("applies min-w-0 class to the file title span", () => {
      const file = createFile({ title: "API Reference" });
      renderSidebar({ tree: [file] });

      const titleElement = screen.getByText("API Reference");
      expect(titleElement.classList.contains("min-w-0")).toBe(true);
    });

    it("applies min-w-0 and truncate classes to file titles with long text", () => {
      const longTitle = "An extremely long document title that would normally overflow the tree sidebar container";
      const file = createFile({ title: longTitle });
      renderSidebar({ tree: [file] });

      const titleElement = screen.getByText(longTitle);
      expect(titleElement.classList.contains("min-w-0")).toBe(true);
      expect(titleElement.classList.contains("truncate")).toBe(true);
    });

    it("applies min-w-0 class to file titles with short text", () => {
      const file = createFile({ title: "FAQ" });
      renderSidebar({ tree: [file] });

      const titleElement = screen.getByText("FAQ");
      expect(titleElement.classList.contains("min-w-0")).toBe(true);
    });

    it("wraps the file title in a tooltip trigger", () => {
      const file = createFile({ title: "Architecture Overview" });
      renderSidebar({ tree: [file] });

      // The title text should exist and its parent chain should include the TooltipTrigger (rendered as asChild).
      // The span with the title is inside a button which is the TooltipTrigger via asChild.
      const titleElement = screen.getByText("Architecture Overview");
      // Verify the span is inside a button (the TooltipTrigger uses asChild on the button's child)
      const parentButton = titleElement.closest("button");
      expect(parentButton).not.toBeNull();
    });

    it("shows unread indicator when isRead is false", () => {
      const file = createFile({ isRead: false });
      renderSidebar({ tree: [file] });

      const unreadDot = document.querySelector(".animate-pulse.bg-primary");
      expect(unreadDot).not.toBeNull();
    });

    it("does not show unread indicator when isRead is true", () => {
      const file = createFile({ isRead: true });
      renderSidebar({ tree: [file] });

      const unreadDot = document.querySelector(".animate-pulse.bg-primary");
      expect(unreadDot).toBeNull();
    });

    it("shows favorite button with correct aria-label for non-favorited file", () => {
      const file = createFile({ isFavorited: false });
      renderSidebar({ tree: [file] });

      expect(screen.getByLabelText("Add to favorites")).toBeInTheDocument();
    });

    it("shows favorite button with correct aria-label for favorited file", () => {
      const file = createFile({ isFavorited: true });
      renderSidebar({ tree: [file] });

      expect(screen.getByLabelText("Remove from favorites")).toBeInTheDocument();
    });
  });

  describe("Nested tree rendering", () => {
    it("renders files inside an expanded folder", () => {
      const file = createFile({ id: "nested-file", title: "Nested Doc" });
      const folder = createFolder({
        id: "parent-folder",
        name: "Parent",
        children: [file],
      });

      renderSidebar({
        tree: [folder],
        expandedFolders: new Set(["parent-folder"]),
      });

      expect(screen.getByText("Parent")).toBeInTheDocument();
      expect(screen.getByText("Nested Doc")).toBeInTheDocument();
    });

    it("does not render children when folder is collapsed", () => {
      const file = createFile({ id: "hidden-file", title: "Hidden Doc" });
      const folder = createFolder({
        id: "collapsed-folder",
        name: "Collapsed",
        children: [file],
      });

      renderSidebar({
        tree: [folder],
        expandedFolders: new Set(),
      });

      expect(screen.getByText("Collapsed")).toBeInTheDocument();
      expect(screen.queryByText("Hidden Doc")).toBeNull();
    });
  });

  describe("Selected state", () => {
    it("applies selected styling to the active file", () => {
      const file = createFile({ id: "selected-file", title: "Selected Doc" });
      renderSidebar({
        tree: [file],
        selectedDocumentId: "selected-file",
      });

      const fileContainer = screen.getByText("Selected Doc").closest("[class*='bg-primary']");
      expect(fileContainer).not.toBeNull();
    });
  });
});
