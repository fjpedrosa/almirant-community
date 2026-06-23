import { test, expect } from "../fixtures/auth.fixture";

const SCROLL_TOLERANCE = 50;

test.describe("Seeds — pagination, scroll & footer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/seeds");
    await page.waitForLoadState("networkidle");
  });

  test("pagination summary is always visible", async ({ page }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });
    await expect(summary).toHaveText(/Mostrando \d+[-–]\d+ de \d+/);
  });

  test("pagination controls are always rendered", async ({ page }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const controls = page.getByTestId("pagination-controls");
    await expect(controls).toBeVisible();
  });

  test("pagination buttons are disabled on single page", async ({ page }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const summaryText = await summary.textContent();
    const match = summaryText?.match(/de (\d+)/);
    const totalItems = match ? Number(match[1]) : 0;

    if (totalItems <= 20) {
      const controls = page.getByTestId("pagination-controls");
      const buttons = controls.getByRole("button");
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        await expect(buttons.nth(i)).toBeDisabled();
      }
    }
  });

  test("no ghost scroll or extra space after load", async ({ page }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const content = page.getByTestId("list-page-shell-content");
    const { scrollHeight, clientHeight } = await content.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    expect(scrollHeight).toBeLessThanOrEqual(clientHeight + SCROLL_TOLERANCE);
  });

  test("no ghost scroll after navigating pages", async ({ page }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const controls = page.getByTestId("pagination-controls");
    const nextBtn = controls.getByRole("button").last();
    if (!(await nextBtn.isEnabled())) return;

    await nextBtn.click();
    await page.waitForLoadState("networkidle");

    const content = page.getByTestId("list-page-shell-content");
    const scrollTop = await content.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBe(0);
  });

  test("scroll resets to top after filter / search change", async ({
    page,
  }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const searchInput = page
      .getByRole("searchbox")
      .or(page.getByPlaceholder(/buscar|search|filtrar/i));

    if ((await searchInput.count()) === 0) return;

    await searchInput.first().fill("zzz_nonexistent_term");
    await page.waitForLoadState("networkidle");

    const content = page.getByTestId("list-page-shell-content");
    const scrollTop = await content.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBe(0);
  });

  test("pagination summary stays visible after navigating pages", async ({
    page,
  }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const controls = page.getByTestId("pagination-controls");
    const nextBtn = controls.getByRole("button").last();
    if (!(await nextBtn.isEnabled())) return;

    await nextBtn.click();
    await page.waitForLoadState("networkidle");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(/Mostrando \d+[-–]\d+ de \d+/);
  });

  test("footer is visible within the viewport without scrolling", async ({
    page,
  }) => {
    const summary = page.getByTestId("pagination-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });

    const viewportSize = page.viewportSize();
    if (!viewportSize) return;

    const summaryBox = await summary.boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(
      viewportSize.height,
    );
  });
});
