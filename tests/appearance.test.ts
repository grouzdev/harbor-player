import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
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
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

describe("appearance storage", () => {
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
