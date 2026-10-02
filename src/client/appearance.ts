export type AppearanceTheme = "dark" | "light";

import { readMigratedStorageValue } from "./storage";
import { backgroundPresets } from "./background-presets";

export type AppearanceSettings = {
  theme: AppearanceTheme;
  accent: string;
  backgroundRevision: number;
  backgroundPreset?: number;
};

export const defaultAppearance: AppearanceSettings = {
  theme: "dark",
  accent: "#b8bd82",
  backgroundRevision: 0,
};

const storageKey = "harbor-player-appearance-v1";
const legacyStorageKey = "mml-appearance-v1";
const accentPattern = /^#[0-9a-f]{6}$/i;

export function normalizeAppearance(value: unknown): AppearanceSettings {
  if (!value || typeof value !== "object") return defaultAppearance;
  const candidate = value as Partial<AppearanceSettings>;
  return {
    theme: "dark",
    accent:
      typeof candidate.accent === "string" &&
      accentPattern.test(candidate.accent)
        ? candidate.accent.toLowerCase()
        : defaultAppearance.accent,
    backgroundRevision:
      Number.isSafeInteger(candidate.backgroundRevision) &&
      (candidate.backgroundRevision || 0) >= 0
        ? candidate.backgroundRevision!
        : 0,
    ...(Number.isInteger(candidate.backgroundPreset) &&
    candidate.backgroundPreset! >= 1 &&
    candidate.backgroundPreset! <= 5
      ? { backgroundPreset: candidate.backgroundPreset }
      : {}),
  };
}

export function readCachedAppearance(): AppearanceSettings {
  try {
    return normalizeAppearance(
      JSON.parse(
        readMigratedStorageValue(storageKey, legacyStorageKey) || "null",
      ),
    );
  } catch {
    return defaultAppearance;
  }
}

export function cacheAppearance(settings: AppearanceSettings) {
  localStorage.setItem(
    storageKey,
    JSON.stringify(normalizeAppearance(settings)),
  );
}

export function applyAppearance(settings: AppearanceSettings) {
  const normalized = normalizeAppearance(settings);
  document.documentElement.dataset.theme = normalized.theme;
  document.documentElement.style.setProperty("--accent", normalized.accent);
  if (normalized.backgroundRevision > 0) {
    document.documentElement.style.setProperty(
      "--appearance-background",
      `url("/api/appearance/background?v=${normalized.backgroundRevision}")`,
    );
  } else if (normalized.backgroundPreset) {
    const preset = backgroundPresets.find(
      (preset) => preset.number === normalized.backgroundPreset,
    );
    if (preset) {
      document.documentElement.style.setProperty(
        "--appearance-background",
        `url("${preset.url}")`,
      );
    } else {
      document.documentElement.style.removeProperty("--appearance-background");
    }
  } else {
    document.documentElement.style.removeProperty("--appearance-background");
  }
}
