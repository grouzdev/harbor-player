import { expect, test, type Locator, type Page } from "@playwright/test";
import { preparePulseAudio, startAudio } from "./pulse-audio-helpers";

const bubble = (page: Page) => page.locator(".value-bubble[role=tooltip]");

async function hoverAt(page: Page, slider: Locator, ratio: number) {
  await expect(slider).toBeVisible();
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  // Stay inside the hit area at the right endpoint; rounding still yields max.
  await page.mouse.move(
    box!.x + Math.min(box!.width - 0.1, box!.width * ratio),
    box!.y + box!.height / 2,
  );
}

async function expectBubbleInsideViewport(page: Page) {
  await expect(bubble(page)).toBeVisible();
  await expect
    .poll(() =>
      bubble(page).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight
        );
      }),
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  // Each browser context starts with its own explicit player state, regardless
  // of the catalog left on the shared e2e server by other files.
  await page.addInitScript(() => {
    localStorage.removeItem("harbor-player-queue");
    localStorage.removeItem("mml-queue");
    localStorage.setItem("harbor-player-volume", "0.5");
  });
});

test("volume hover previews percentages without changing volume and hides on leave", async ({
  page,
}) => {
  await page.goto("/");
  const slider = page.locator(".player .volume-range");
  const input = page.getByRole("slider", { name: "Громкость", exact: true });
  await expect(input).toHaveValue("0.5");
  await expect(bubble(page)).toBeHidden();

  for (const [ratio, text] of [
    [0.25, "25%"],
    [0.75, "75%"],
  ] as const) {
    await hoverAt(page, slider, ratio);
    await expect(bubble(page)).toHaveText(text);
    await expectBubbleInsideViewport(page);
    await expect(input).toHaveValue("0.5");
    expect(
      await page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.volume),
    ).toBe(0.5);
  }

  await page.mouse.move(0, 0);
  await expect(bubble(page)).toBeHidden();
});

test("volume hover shows both endpoints with the entire bubble inside the viewport", async ({
  page,
}) => {
  await page.goto("/");
  const slider = page.locator(".player .volume-range");
  for (const [ratio, text] of [
    [0, "0%"],
    [1, "100%"],
  ] as const) {
    await hoverAt(page, slider, ratio);
    await expect(bubble(page)).toHaveText(text);
    await expectBubbleInsideViewport(page);
    await expect(
      page.getByRole("slider", { name: "Громкость", exact: true }),
    ).toHaveValue("0.5");
  }
});

test("dragging the volume thumb updates its bubble and keeps it visible outside the track", async ({
  page,
}) => {
  await page.goto("/");
  const slider = page.locator(".player .volume-range");
  const input = page.getByRole("slider", { name: "Громкость", exact: true });
  await expect(input).toHaveValue("0.5");
  await slider.locator(".range-slider-thumb--single").hover();
  await page.mouse.down();
  try {
    for (const [ratio, value, text] of [
      [0.25, "0.25", "25%"],
      [0.75, "0.75", "75%"],
    ] as const) {
      await hoverAt(page, slider, ratio);
      await expect(input).toHaveValue(value);
      await expect(bubble(page)).toHaveText(text);
      await expectBubbleInsideViewport(page);
    }
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width + 20, box.y + box.height / 2);
    await expect(input).toHaveValue("1");
    await expect(bubble(page)).toHaveText("100%");
    await expectBubbleInsideViewport(page);
  } finally {
    await page.mouse.up();
  }
  await page.mouse.move(0, 0);
  await expect(bubble(page)).toBeHidden();
});

test("disabled seek does not show a value bubble", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("slider", { name: "Позиция воспроизведения", exact: true }),
  ).toBeDisabled();
  for (const ratio of [0.25, 0.75]) {
    await hoverAt(page, page.locator(".player .seek-range"), ratio);
    await expect(bubble(page)).toBeHidden();
  }
});

test("seek hover previews formatted time without seeking a real audio track", async ({
  page,
}, info) => {
  await preparePulseAudio(page, info, 120);
  await startAudio(page);
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  const audio = page.locator("audio");
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
    .toBe(true);
  const input = page.getByRole("slider", {
    name: "Позиция воспроизведения",
    exact: true,
  });
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute("max", "120");
  const before = await audio.evaluate(
    (element: HTMLAudioElement) => element.currentTime,
  );
  const inputBefore = await input.inputValue();
  for (const [ratio, text] of [
    [0.25, "0:30"],
    [0.75, "1:30"],
    [0, "0:00"],
    [1, "2:00"],
  ] as const) {
    await hoverAt(page, page.locator(".player .seek-range"), ratio);
    await expect(bubble(page)).toHaveText(text);
    await expectBubbleInsideViewport(page);
    await expect(input).toHaveValue(inputBefore);
    expect(
      await audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    ).toBe(before);
  }
  await page.mouse.move(0, 0);
  await expect(bubble(page)).toBeHidden();
});
