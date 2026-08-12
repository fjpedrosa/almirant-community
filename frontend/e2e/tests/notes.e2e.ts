import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";

type AuthState = {
  token: string;
  userId: string;
  viewerToken?: string;
  viewerUserId?: string;
  projects?: Record<string, { viewerToken?: string }>;
};

type ApiEnvelope<T> = { success: boolean; data: T; error?: string };
type ApiNote = { id: string; title: string; stateVersion: number; lexicalJson: Record<string, unknown> };

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const readAuthState = (): AuthState => {
  const path = resolve(__dirname, "../.auth-state.json");
  if (!existsSync(path)) throw new Error("Playwright auth state was not created");
  return JSON.parse(readFileSync(path, "utf8")) as AuthState;
};

const api = async <T>(page: Page, path: string, method = "GET", data?: unknown): Promise<T> => {
  const response = await page.request.fetch(`${API_URL}/api${path}`, { method, data });
  const body = await response.json() as ApiEnvelope<T>;
  expect(response.ok(), `${method} ${path}: ${body.error ?? response.statusText()}`).toBeTruthy();
  expect(body.success).toBeTruthy();
  return body.data;
};

const paragraphDocument = (text: string) => ({
  root: {
    type: "root",
    version: 1,
    children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text }] }],
  },
});

const checklistDocument = (itemId: string, text: string) => ({
  root: {
    type: "root",
    version: 1,
    children: [{
      type: "check-list",
      version: 1,
      children: [{ type: "check-listitem", version: 1, itemId, checked: false, children: [{ type: "text", version: 1, text }] }],
    }],
  },
});

const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftLocalDate = (amount: number) => {
  const date = new Date();
  date.setDate(date.getDate() + amount);
  return localDate(date);
};

const waitForSaved = async (page: Page) => {
  await expect(page.getByText(/Guardado|Saved/, { exact: true })).toBeVisible({ timeout: 15_000 });
};

const clickVisible = async (page: Page, role: "button" | "link", name: RegExp) => {
  const candidates = page.getByRole(role, { name });
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`No visible ${role} matched ${name}`);
};

const openNotesSidebar = async (page: Page) => {
  await page.addStyleTag({ content: "nextjs-portal { pointer-events: none !important; }" });
  const open = page.getByRole("button", { name: /Abrir navegación de Notas|Open Notes navigation/i });
  if (await open.isVisible()) {
    await open.click();
    await expect(page.getByRole("dialog", { name: /Navegación de Notas|Notes navigation/i })).toBeVisible();
  }
};

const createPrivatePage = (page: Page, title: string, body = title) => api<ApiNote>(page, "/notes/pages", "POST", {
  title,
  visibility: "private",
  lexicalJson: paragraphDocument(body),
});

const viewerPage = async (browser: Browser, projectName: string) => {
  const state = readAuthState();
  const viewerToken = state.projects?.[projectName]?.viewerToken ?? state.viewerToken;
  expect(viewerToken).toBeTruthy();
  const url = new URL(BASE_URL);
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([{
    name: "better-auth.session_token",
    value: viewerToken!,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  }]);
  return { context, page: await context.newPage() };
};

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("Notes — authenticated production journey", () => {
  test("opens today's real daily note and autosaves an exact local draft", async ({ page }) => {
    await page.goto("/notes");
    const title = page.getByLabel(/Nota sin título|Untitled note/i);
    await expect(title).toBeVisible({ timeout: 15_000 });
    const uniqueTitle = `Daily E2E ${Date.now()}`;
    await title.fill(uniqueTitle);
    const editor = page.getByLabel(/Escribe, planifica|Write, plan/i);
    await editor.click();
    await editor.type("A production-path note saved by Playwright.");
    await waitForSaved(page);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/auth/get-session") && response.ok()),
      page.reload(),
    ]);
    await expect(page.getByLabel(/Nota sin título|Untitled note/i)).toHaveValue(uniqueTitle, { timeout: 15_000 });
    await expect(page.getByText("A production-path note saved by Playwright.")).toBeVisible({ timeout: 15_000 });
  });

  test("flushes an immediate top-product navigation before leaving Notes", async ({ page }) => {
    await page.goto("/notes");
    const title = page.getByLabel(/Nota sin título|Untitled note/i);
    const value = `Immediate nav ${Date.now()}`;
    await title.fill(value);
    const planLinks = page.locator('a[href="/plan"]');
    let planLink = planLinks.first();
    if (!(await planLink.isVisible())) {
      const menu = page.getByRole("button", { name: /Menú|Menu|navegación/i }).first();
      if (await menu.isVisible()) await menu.click();
      for (let index = 0; index < await planLinks.count(); index += 1) {
        if (await planLinks.nth(index).isVisible()) { planLink = planLinks.nth(index); break; }
      }
    }
    await expect(planLink).toBeVisible();
    await planLink.click();
    await expect(page).toHaveURL(/\/plan/);
    await page.goto("/notes");
    await expect(page.getByLabel(/Nota sin título|Untitled note/i)).toHaveValue(value);
  });

  test("keeps long titles and narrow date actions inside the mobile viewport", async ({ page }) => {
    const longTitle = `Long unbroken title ${"x".repeat(180)}`;
    const note = await createPrivatePage(page, longTitle);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(`/notes/${note.id}`);

      const title = page.getByLabel(/Nota sin título|Untitled note/i);
      await expect(title).toHaveValue(longTitle);
      const breadcrumb = page.locator("article nav[aria-label] [aria-current='page'], article nav[aria-label] a").first();
      await expect(breadcrumb).toBeVisible();
      const breadcrumbGeometry = await breadcrumb.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: rect.left, right: rect.right, textOverflow: style.textOverflow };
      });
      expect(breadcrumbGeometry.textOverflow).toBe("ellipsis");
      expect(breadcrumbGeometry.left).toBeGreaterThanOrEqual(0);
      expect(breadcrumbGeometry.right).toBeLessThanOrEqual(width);
      const titleGeometry = await title.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: rect.left, right: rect.right, textOverflow: style.textOverflow };
      });
      expect(titleGeometry.textOverflow).toBe("ellipsis");
      expect(titleGeometry.left).toBeGreaterThanOrEqual(0);
      expect(titleGeometry.right).toBeLessThanOrEqual(width);

      await page.goto("/notes");
      for (const control of [
        page.getByRole("button", { name: /Día anterior|Previous day/i }),
        page.getByRole("button", { name: /Día siguiente|Next day/i }),
      ]) {
        const geometry = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(width);
      }
    }
  });

  test("creates a parent and child through the UI and resolves an internal backlink", async ({ page }) => {
    const stamp = Date.now();
    const parentTitle = `E2E parent ${stamp}`;
    const childTitle = `E2E child ${stamp}`;

    await page.goto("/notes");
    await openNotesSidebar(page);
    await clickVisible(page, "button", /Nueva página|New page/i);
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i);
    const parentUrl = page.url();
    await page.getByLabel(/Nota sin título|Untitled note/i).fill(parentTitle);
    await waitForSaved(page);

    await page.getByRole("button", { name: /Crear página hija|Create child page/i }).click();
    await expect(page).not.toHaveURL(parentUrl);
    await page.getByLabel(/Nota sin título|Untitled note/i).fill(childTitle);
    await waitForSaved(page);
    const editor = page.getByLabel(/Escribe, planifica|Write, plan/i);
    await editor.click();
    await editor.type("Open the parent note");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.getByRole("button", { name: /Enlace a nota|Link to note/i }).click();
    const linkDialog = page.getByRole("dialog", { name: /Elige una nota para enlazar|Choose a note to link/i });
    await linkDialog.getByLabel(/Elige una nota para enlazar|Choose a note to link/i).selectOption({ label: parentTitle });
    await linkDialog.getByRole("button", { name: /Guardar enlace|Save link/i }).click();
    await waitForSaved(page);
    const internalLink = editor.getByRole("link", { name: "Open the parent note" });
    await expect(internalLink).toHaveAttribute("href", new RegExp(`/notes/[0-9a-f-]{36}$`, "i"));
    await page.goto((await internalLink.getAttribute("href"))!);
    await expect(page.getByLabel(/Nota sin título|Untitled note/i)).toHaveValue(parentTitle);
    await page.reload();
    const backlinks = page.locator('section[aria-labelledby="notes-backlinks"]');
    await expect(backlinks.getByRole("link", { name: childTitle })).toBeVisible();
  });

  test("completes carryover on its original daily page and renders audit metadata", async ({ page }) => {
    const previousDate = shiftLocalDate(-1);
    const itemId = crypto.randomUUID();
    const itemText = `Carryover E2E ${Date.now()}`;
    const previous = await api<ApiNote>(page, `/notes/agenda/${previousDate}`, "PUT");
    await api<ApiNote>(page, `/notes/pages/${previous.id}`, "PATCH", {
      expectedVersion: previous.stateVersion,
      lexicalJson: checklistDocument(itemId, itemText),
    });

    await page.goto("/notes");
    const carryover = page.locator('section[aria-labelledby="notes-carryover-title"]');
    await expect(carryover.getByText(itemText)).toBeVisible();
    await carryover.getByRole("checkbox", { name: itemText }).click();
    await expect(carryover.getByText(itemText)).not.toBeVisible();

    await page.goto(`/notes/agenda/${previousDate}`);
    const sourceItem = page.locator(`[data-check-item-id="${itemId}"]`);
    await expect(sourceItem).toHaveAttribute("aria-checked", "true");
    await expect(sourceItem.locator("[data-note-check-audit]")).toContainText(/Completado|Completed/i);
  });

  test("shares a private page with a real viewer and keeps unshared pages undisclosed", async ({ page, browser }, testInfo) => {
    const stamp = Date.now();
    const sharedTitle = `Shared E2E ${stamp}`;
    const sharedBody = `Viewer body ${stamp}`;
    const shared = await createPrivatePage(page, sharedTitle, sharedBody);
    const privatePage = await createPrivatePage(page, `Private E2E ${stamp}`, "This stays private");
    // Attach the member response listener before entering the page so the
    // query's first request cannot race the test in a combined project run.
    const memberResponse = page.waitForResponse((response) =>
      response.url().includes("/api/auth/organization/get-full-organization"),
    );
    await Promise.all([memberResponse, page.goto(`/notes/${shared.id}`)]).then(([response]) => {
      expect(response.ok(), `member query returned ${response.status()} ${response.statusText()}`).toBeTruthy();
    });
    await page.getByRole("button", { name: /Compartir|Share/i }).click();
    const shareDialog = page.getByRole("dialog", { name: /Compartir nota|Share note/i });
    const memberSelect = shareDialog.getByLabel(/Persona|Person/i);
    await expect(memberSelect.locator("option", { hasText: "Notes Viewer" })).toHaveCount(1, { timeout: 30_000 });
    await memberSelect.selectOption({ label: "Notes Viewer" });
    await shareDialog.getByLabel(/Rol|Role/i).selectOption("viewer");
    await shareDialog.getByRole("button", { name: /Guardar acceso|Save access/i }).click();
    await expect(shareDialog.getByText(/Notes Viewer · (Lector|Viewer)/i)).toBeVisible();
    await shareDialog.getByRole("button", { name: /Cerrar|Close/i }).first().click();

    const viewer = await viewerPage(browser, testInfo.project.name);
    try {
      await viewer.page.goto(`/notes/${shared.id}`);
      const viewerTitle = viewer.page.getByRole("heading", { level: 1, name: sharedTitle });
      await expect(viewerTitle).toBeVisible({ timeout: 15_000 });
      await expect(viewer.page.getByLabel(/Nota sin título|Untitled note/i)).toHaveCount(0);
      await expect(viewer.page.getByText(sharedBody)).toBeVisible({ timeout: 15_000 });
      await expect(viewer.page.getByText(/solo un editor|only an editor/i)).toBeVisible({ timeout: 15_000 });
      await expect(viewer.page.getByRole("toolbar", { name: /Formato del editor|Editor formatting/i })).not.toBeVisible();
      await expect(viewer.page.getByRole("button", { name: /Compartir|Share/i })).not.toBeVisible();
      await expect(viewer.page.getByRole("button", { name: /Mover|Move/i })).not.toBeVisible();
      await expect(viewer.page.getByRole("button", { name: /Archivar|Archive/i })).not.toBeVisible();

      await viewer.page.goto(`/notes/${privatePage.id}`);
      await expect(viewer.page.getByText(/no está disponible|is unavailable/i)).toBeVisible({ timeout: 15_000 });
      await expect(viewer.page.getByText("This stays private")).not.toBeVisible();
    } finally {
      await viewer.context.close();
    }
  });

  test("preserves a stale local draft on CAS conflict and creates a private copy", async ({ page }) => {
    const original = await createPrivatePage(page, `Conflict base ${Date.now()}`);
    await page.goto(`/notes/${original.id}`);
    const competing = await page.context().newPage();
    await competing.goto(`/notes/${original.id}`);
    const winnerTitle = `Conflict winner ${Date.now()}`;
    const localTitle = `Conflict local ${Date.now()}`;
    await page.getByLabel(/Nota sin título|Untitled note/i).fill(winnerTitle);
    await waitForSaved(page);
    await competing.getByLabel(/Nota sin título|Untitled note/i).fill(localTitle);
    const dialog = competing.getByRole("dialog", { name: /Esta nota cambió|This note changed elsewhere/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(localTitle)).toBeVisible();
    await dialog.getByRole("button", { name: /Crear una copia privada|Create a private copy/i }).click();
    await expect(competing).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i);
    await expect(competing.getByLabel(/Nota sin título|Untitled note/i)).toHaveValue(localTitle, { timeout: 30_000 });
    await expect(competing.getByRole("combobox", { name: /Visibilidad|Visibility/i })).toHaveValue("private", { timeout: 30_000 });
    await competing.close();
  });

  test("restores an archived page and atomically converts and discards legacy work", async ({ page }) => {
    const stamp = Date.now();
    const archivedTitle = `Archived E2E ${stamp}`;
    const archived = await createPrivatePage(page, archivedTitle);
    await page.goto(`/notes/${archived.id}`);
    await page.getByRole("button", { name: /Archivar|Archive/i }).click();
    const archiveDialog = page.getByRole("alertdialog");
    await archiveDialog.getByRole("button", { name: /Archivar|Archive/i, exact: true }).click();
    await expect(page).toHaveURL(/\/notes\/archive$/);
    await page.getByRole("button", { name: new RegExp(`(?:Restaurar|Restore) ${archivedTitle}`) }).click();
    await expect(page).toHaveURL(`/notes/${archived.id}`);
    await expect(page.getByLabel(/Nota sin título|Untitled note/i)).toHaveValue(archivedTitle);

    const convertTitle = `Legacy convert ${stamp}`;
    const discardTitle = `Legacy discard ${stamp}`;
    for (const title of [convertTitle, discardTitle]) {
      await api(page, "/todos", "POST", {
        title,
        description: `${title} full immutable source`,
        status: "pending",
        priority: "medium",
        projectId: null,
        ownerUserId: null,
        dueDate: null,
      });
    }
    await page.goto("/notes/archive");
    await page.getByRole("button", { name: new RegExp(`(?:Convertir en nota|Convert to note) ${convertTitle}`) }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/i);
    await expect(page.getByLabel(/Nota sin título|Untitled note/i)).toHaveValue(convertTitle);
    await expect(page.getByText(`${convertTitle} full immutable source`, { exact: false })).toBeVisible();

    await page.goto("/notes/archive");
    await page.getByRole("button", { name: new RegExp(`(?:Descartar de la revisión|Discard from review) ${discardTitle}`) }).click();
    const discardDialog = page.getByRole("alertdialog");
    await discardDialog.getByRole("button", { name: /Descartar|Discard/i, exact: true }).click();
    const legacyRow = page.getByText(discardTitle).locator("..", { hasText: discardTitle });
    await expect(legacyRow).toContainText(/Descartado|Discarded/i);
  });
});
