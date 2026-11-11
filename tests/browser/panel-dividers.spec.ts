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

test("catalog and settings dividers accept margin drags and keyboard resizing", async ({
  page,
}) => {
  await page.goto("/");
  const divider = page.getByRole("separator", {
    name: "Ширина: Библиотеки — Жанры",
  });
  await dragFromMargin(divider, "left");
  await dragFromMargin(divider, "right");

  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settingsDivider = page
    .getByRole("main", { name: "Настройки" })
    .getByRole("separator")
    .first();
  await dragFromMargin(settingsDivider, "left");
  await dragFromMargin(settingsDivider, "right");
  await settingsDivider.focus();
  await expect(settingsDivider).toBeFocused();
  const before = (await settingsDivider.boundingBox())!;
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await settingsDivider.boundingBox())!.x)
    .toBeGreaterThan(before.x);
});
