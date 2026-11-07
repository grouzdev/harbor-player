import { expect, test, type Locator } from "./fixtures";

async function dragFromMargin(divider: Locator, side: "left" | "right") {
  const page = divider.page();
  const before = await divider.boundingBox();
  if (!before) throw new Error("Divider is not visible");
  const x = side === "left" ? before.x - 4 : before.x + before.width + 4;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  expect(
    await divider.evaluate(
      (element, point) =>
        document.elementFromPoint(point.x, point.y) === element,
      { x, y },
    ),
  ).toBe(true);
  const delta = side === "left" ? 24 : -24;
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await divider.boundingBox())!.x)
    .toBeCloseTo(before.x + delta, 0);
  await page.mouse.move(0, 0);
}

for (const theme of ["dark", "light"]) {
  test(`vertical dividers stay recessed in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Light is a legacy CSS variant, not a selectable application theme.
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);

    const divider = page.getByRole("separator", {
      name: "Ширина: Библиотеки — Жанры",
    });
    const groove = await divider.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    );
    expect(groove).toContain(
      theme === "dark" ? "rgb(9, 10, 9)" : "rgb(133, 141, 133)",
    );
    const edge = theme === "dark" ? "rgb(25, 26, 24)" : "rgb(226, 231, 227)";
    expect(groove).toContain(`${edge},`);
    expect(groove).toContain(`${edge})`);
    expect(groove).toContain("45%");
    expect(groove).toContain("55%");
    const highlight = groove.replaceAll(
      theme === "dark" ? "rgb(9, 10, 9)" : "rgb(133, 141, 133)",
      theme === "dark" ? "rgb(75, 78, 55)" : "rgb(160, 170, 135)",
    );
    await expect(divider).toHaveCSS("width", "4px");
    const sidebarGroove = await page
      .locator(".catalog-sidebar")
      .evaluate(
        (element) => getComputedStyle(element, "::before").backgroundImage,
      );
    expect(sidebarGroove).toBe(`${groove}, none`);
    await divider.hover();
    await expect(divider).toHaveCSS("background-image", highlight);
    await expect(divider).toHaveCSS("box-shadow", "none");
    await page.screenshot({
      path: testInfo.outputPath(`catalog-hover-${theme}.png`),
    });
    await page.mouse.down();
    await expect(divider).toHaveCSS("background-image", highlight);
    await expect(divider).toHaveCSS("box-shadow", "none");
    await page.mouse.up();
    await page.mouse.move(0, 0);
    await dragFromMargin(divider, "left");
    await dragFromMargin(divider, "right");
    await page.screenshot({
      path: testInfo.outputPath(`catalog-${theme}.png`),
    });

    await page.setViewportSize({ width: 1000, height: 1200 });
    await expect(divider).toHaveCSS("background-image", groove);
    await expect(
      page.getByRole("separator", { name: "Высота строк" }),
    ).not.toHaveCSS("background-image", groove);
    await page.setViewportSize({ width: 1600, height: 1000 });

    await page.getByRole("button", { name: "Открыть настройки" }).click();
    const settingsDivider = page
      .getByRole("main", { name: "Настройки" })
      .getByRole("separator")
      .first();
    await expect(settingsDivider).toHaveCSS("background-image", groove);
    await settingsDivider.hover();
    await expect(settingsDivider).toHaveCSS("background-image", highlight);
    await expect(settingsDivider).toHaveCSS("box-shadow", "none");
    await settingsDivider.focus();
    await expect(settingsDivider).toHaveCSS("background-image", highlight);
    await expect(settingsDivider).toHaveCSS("box-shadow", "none");
    await dragFromMargin(settingsDivider, "left");
    await dragFromMargin(settingsDivider, "right");
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: testInfo.outputPath(`settings-${theme}.png`),
    });
  });
}
