export type AppearanceTheme = "dark" | "light";

export type AppearanceSettings = {
  theme: AppearanceTheme;
  accent: string;
  backgroundRevision: number;
};

export const defaultAppearance: AppearanceSettings = {
  theme: "dark",
  accent: "#b8bd82",
  backgroundRevision: 0,
};

const storageKey = "mml-appearance-v1";
const accentPattern = /^#[0-9a-f]{6}$/i;

export function normalizeAppearance(value: unknown): AppearanceSettings {
  if (!value || typeof value !== "object") return defaultAppearance;
  const candidate = value as Partial<AppearanceSettings>;
  return {
    theme: candidate.theme === "light" ? "light" : "dark",
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
  };
}

export function readCachedAppearance(): AppearanceSettings {
  try {
    return normalizeAppearance(
      JSON.parse(localStorage.getItem(storageKey) || "null"),
    );
  } catch {
    return defaultAppearance;
  }
}

export function cacheAppearance(settings: AppearanceSettings) {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

export function applyAppearance(settings: AppearanceSettings) {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty("--accent", settings.accent);
  if (settings.backgroundRevision > 0) {
    document.documentElement.style.setProperty(
      "--appearance-background",
      `url("/api/appearance/background?v=${settings.backgroundRevision}")`,
    );
  } else {
    document.documentElement.style.removeProperty("--appearance-background");
  }
}
