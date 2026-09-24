import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export type AppearanceSettings = {
  theme: "dark" | "light";
  accent: string;
  backgroundRevision: number;
};

export const defaultAppearance: AppearanceSettings = {
  theme: "dark",
  accent: "#b8bd82",
  backgroundRevision: 0,
};
const accent = /^#[0-9a-f]{6}$/i;

export async function readAppearance(
  dataDir: string,
): Promise<AppearanceSettings> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(dataDir, "appearance.json"), "utf8"),
    ) as Partial<AppearanceSettings>;
    return {
      theme: "dark",
      accent:
        typeof parsed.accent === "string" && accent.test(parsed.accent)
          ? parsed.accent.toLowerCase()
          : defaultAppearance.accent,
      backgroundRevision:
        Number.isSafeInteger(parsed.backgroundRevision) &&
        (parsed.backgroundRevision || 0) >= 0
          ? parsed.backgroundRevision!
          : 0,
    };
  } catch {
    return defaultAppearance;
  }
}

export async function writeAppearance(
  dataDir: string,
  settings: AppearanceSettings,
) {
  const normalized: AppearanceSettings = {
    ...settings,
    theme: "dark",
    accent: settings.accent.toLowerCase(),
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    path.join(dataDir, "appearance.json"),
    JSON.stringify(normalized),
    "utf8",
  );
  return normalized;
}

export const appearanceBackgroundPath = (dataDir: string) =>
  path.join(dataDir, "appearance", "background.jpg");

export async function importAppearanceBackground(
  dataDir: string,
  source: Buffer | string,
) {
  const target = appearanceBackgroundPath(dataDir);
  await mkdir(path.dirname(target), { recursive: true });
  await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 3840,
      height: 2160,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toFile(target);
  const current = await readAppearance(dataDir);
  return writeAppearance(dataDir, {
    ...current,
    backgroundRevision: current.backgroundRevision + 1,
  });
}

export async function clearAppearanceBackground(dataDir: string) {
  const target = appearanceBackgroundPath(dataDir);
  if (existsSync(target)) await unlink(target);
  const current = await readAppearance(dataDir);
  return writeAppearance(dataDir, { ...current, backgroundRevision: 0 });
}
