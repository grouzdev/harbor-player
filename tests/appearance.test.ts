import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { applyAppearance, normalizeAppearance } from "../src/client/appearance";
import { backgroundPresets } from "../src/client/background-presets";
import { MAX_BACKGROUND_IMAGE_BYTES } from "../src/shared/appearance-background.js";
import {
  appearanceBackgroundPath,
  clearAppearanceBackground,
  importAppearanceBackground,
  readAppearance,
  writeAppearance,
} from "../dist/server/appearance.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.resolve(".test-data", "appearance-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

describe("appearance storage", () => {
  it("persists presets and clears them on custom import or removal", async () => {
    const settings = {
      theme: "dark" as const,
      accent: "#b8bd82",
      backgroundRevision: 0,
      backgroundPreset: 5,
    };
    await writeAppearance(root, settings);
    expect(await readAppearance(root)).toEqual(settings);
    expect(await clearAppearanceBackground(root)).not.toHaveProperty(
      "backgroundPreset",
    );
    await writeAppearance(root, settings);
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#d04030" },
    })
      .png()
      .toBuffer();
    expect(await importAppearanceBackground(root, source)).not.toHaveProperty(
      "backgroundPreset",
    );
    expect(await readAppearance(root)).not.toHaveProperty("backgroundPreset");
  });

  it.each([0, 6, 1.5, "1", null])(
    "ignores invalid persisted/client preset %s",
    async (backgroundPreset) => {
      const settings = {
        theme: "dark",
        accent: "#b8bd82",
        backgroundRevision: 0,
        backgroundPreset,
      };
      await writeFile(
        path.join(root, "appearance.json"),
        JSON.stringify(settings),
      );
      expect(await readAppearance(root)).not.toHaveProperty("backgroundPreset");
      expect(normalizeAppearance(settings)).not.toHaveProperty(
        "backgroundPreset",
      );
    },
  );

  it("applies bundled presets only without a custom revision and preserves legacy defaults", () => {
    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    vi.stubGlobal("document", { documentElement: { dataset: {}, style } });
    for (const preset of backgroundPresets) {
      const settings = {
        theme: "dark" as const,
        accent: "#b8bd82",
        backgroundRevision: 0,
        backgroundPreset: preset.number,
      };
      expect(normalizeAppearance(settings)).toEqual(settings);
      applyAppearance(settings);
      expect(style.setProperty).toHaveBeenLastCalledWith(
        "--appearance-background",
        `url("${preset.url}")`,
      );
      applyAppearance({ ...settings, backgroundRevision: 2 });
      expect(style.setProperty).toHaveBeenLastCalledWith(
        "--appearance-background",
        'url("/api/appearance/background?v=2")',
      );
    }
    const legacy = {
      theme: "dark" as const,
      accent: "#b8bd82",
      backgroundRevision: 0,
    };
    expect(normalizeAppearance(legacy)).toEqual(legacy);
    applyAppearance(legacy);
    expect(style.removeProperty).toHaveBeenCalledWith(
      "--appearance-background",
    );
  });

  it("accepts sources above 8 MiB and rejects oversized buffers and files", async () => {
    const image = await sharp({
      create: { width: 8, height: 5, channels: 3, background: "#d04030" },
    })
      .png()
      .toBuffer();
    // PNG decoders ignore trailing bytes, keeping this fixture inexpensive.
    const source = Buffer.concat([image, Buffer.alloc(13 * 1024 * 1024)]);
    await expect(
      importAppearanceBackground(root, source),
    ).resolves.toMatchObject({
      backgroundRevision: 1,
    });
    const oversized = Buffer.alloc(MAX_BACKGROUND_IMAGE_BYTES + 1);
    await expect(
      importAppearanceBackground(root, oversized),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    const file = path.join(root, "oversized.png");
    await writeFile(file, oversized);
    await expect(importAppearanceBackground(root, file)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await readAppearance(root)).backgroundRevision).toBe(1);
  });

  it("persists the selected palette, forces the dark theme, and normalizes an imported background", async () => {
    await writeAppearance(root, {
      theme: "light",
      accent: "#79b9d4",
      backgroundRevision: 0,
    });
    const source = await sharp({
      create: { width: 8, height: 5, channels: 4, background: "#d0403080" },
    })
      .png()
      .toBuffer();

    const saved = await importAppearanceBackground(root, source);

    expect(saved).toEqual({
      theme: "dark",
      accent: "#79b9d4",
      backgroundRevision: 1,
    });
    expect(
      (await sharp(appearanceBackgroundPath(root)).metadata()).format,
    ).toBe("jpeg");
    expect(await readAppearance(root)).toEqual(saved);
  });

  it("removes the imported image without resetting the chosen palette", async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#d04030" },
    })
      .jpeg()
      .toBuffer();
    await writeAppearance(root, {
      theme: "light",
      accent: "#79b9d4",
      backgroundRevision: 0,
    });
    await importAppearanceBackground(root, source);

    await expect(clearAppearanceBackground(root)).resolves.toEqual({
      theme: "dark",
      accent: "#79b9d4",
      backgroundRevision: 0,
    });
    await expect(
      sharp(appearanceBackgroundPath(root)).metadata(),
    ).rejects.toThrow();
  });
});
