import { expect, test, type Locator, type Page } from "./fixtures";
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

async function clickAtPanelEdge(
  page: Page,
  slider: Locator,
  ratio: number,
  edge: "top" | "bottom",
) {
  const panel = (await page.locator(".player").boundingBox())!;
  const box = (await slider.boundingBox())!;
  // The top border belongs to the panel, not to its content.
  const y = edge === "top" ? panel.y + 2 : panel.y + panel.height - 2;
  expect(box.y).toBeLessThanOrEqual(y);
  expect(box.y + box.height).toBeGreaterThanOrEqual(y);
  await page.mouse.click(
    box.x + Math.min(box.width - 0.1, box.width * ratio),
    y,
  );
}

async function expectThumbGeometry(slider: Locator, ratio: number) {
  const geometry = await slider.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const thumb = element
      .querySelector(".range-slider-thumb")!
      .getBoundingClientRect();
    const fill = getComputedStyle(element, "::before");
    return {
      expectedX: box.left,
      width: box.width,
      centerX: thumb.left + thumb.width / 2,
      centerY: thumb.top + thumb.height / 2,
      trackCenterY: box.top + box.height / 2,
      fillRight: box.right - parseFloat(fill.right),
      fillCenterY: box.top + parseFloat(fill.top) + parseFloat(fill.height) / 2,
      shadow: getComputedStyle(element.querySelector(".range-slider-thumb")!)
        .boxShadow,
      nativeOpacity: getComputedStyle(element.querySelector("input")!).opacity,
    };
  });
  expect(geometry.centerX).toBeCloseTo(
    geometry.expectedX + geometry.width * ratio,
    0,
  );
  expect(geometry.fillRight).toBeCloseTo(geometry.centerX, 0);
  expect(geometry.centerY).toBeCloseTo(geometry.trackCenterY, 0);
  expect(geometry.fillCenterY).toBeCloseTo(geometry.centerY, 0);
  expect(geometry.shadow).not.toBe("none");
  expect(geometry.nativeOpacity).toBe("0");
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

test("@full volume hover previews percentages without changing volume and hides on leave", async ({
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

test("@full volume hover shows both endpoints with the entire bubble inside the viewport", async ({
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

test("@full dragging the volume thumb updates its bubble and keeps it visible outside the track", async ({
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

test("@full disabled seek does not show a value bubble", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("slider", { name: "Позиция воспроизведения", exact: true }),
  ).toBeDisabled();
  for (const ratio of [0.25, 0.75]) {
    await hoverAt(page, page.locator(".player .seek-range"), ratio);
    await expect(bubble(page)).toBeHidden();
    for (const edge of ["top", "bottom"] as const) {
      await clickAtPanelEdge(
        page,
        page.locator(".player .seek-range"),
        ratio,
        edge,
      );
      await expect(bubble(page)).toBeHidden();
      await expect(
        page.getByRole("slider", {
          name: "Позиция воспроизведения",
          exact: true,
        }),
      ).toHaveValue("0");
    }
  }
});

test("volume accepts full-height clicks with one thumb and fill coordinate system", async ({
  page,
}) => {
  await page.goto("/");
  const slider = page.locator(".player .volume-range");
  const input = page.getByRole("slider", { name: "Громкость", exact: true });
  for (const edge of ["top", "bottom"] as const) {
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      await clickAtPanelEdge(page, slider, ratio, edge);
      await expect(input).toHaveValue(String(ratio));
      await expect(bubble(page)).toHaveText(`${ratio * 100}%`);
      await expectThumbGeometry(slider, ratio);
      expect(
        await page
          .locator("audio")
          .evaluate((audio: HTMLAudioElement) => audio.volume),
      ).toBe(ratio);
    }
  }
  await slider.click({ button: "right", position: { x: 20, y: 2 } });
  await expect(input).toHaveValue("1");
  await page.mouse.move(0, 0);
  await input.focus();
  await input.press("Home");
  await expect(input).toHaveValue("0");
  await input.press("ArrowRight");
  await expect(input).toHaveValue("0.01");
  await expectThumbGeometry(slider, 0.01);
  await input.press("End");
  await expect(input).toHaveValue("1");
});

test("seek accepts full-height clicks in wide and compact layouts", async ({
  page,
}, info) => {
  await preparePulseAudio(page, info, 120);
  await startAudio(page);
  await page.getByRole("button", { name: "Пауза", exact: true }).click();
  const slider = page.locator(".player .seek-range");
  const input = page.getByRole("slider", {
    name: "Позиция воспроизведения",
    exact: true,
  });
  await expect(input).toHaveAttribute("max", "120");
  for (const width of [1600, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const edge of ["top", "bottom"] as const) {
      for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
        await clickAtPanelEdge(page, slider, ratio, edge);
        await expect(input).toHaveValue(String(ratio * 120));
        await expectThumbGeometry(slider, ratio);
        await expect
          .poll(() =>
            page
              .locator("audio")
              .evaluate((audio: HTMLAudioElement) => audio.currentTime),
          )
          .toBeCloseTo(ratio * 120, 1);
      }
    }
  }
});

test("@full seek hover previews formatted time without seeking a real audio track", async ({
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
