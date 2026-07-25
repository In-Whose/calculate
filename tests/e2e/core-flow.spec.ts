import { expect, test } from "@playwright/test";

test("샘플 판을 검토해 정산 미리보기를 표시한다", async ({ page }) => {
  await page.goto("/#/new");
  await page.getByRole("button", { name: "샘플로 체험" }).click();
  await expect(page.getByText("현재 정산")).toBeVisible();
  await expect(page.getByText("명수", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".round-card")).toHaveCount(4);
  const sizes = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width);
});
