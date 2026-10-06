import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { UpdatePreferences } from "../shared/desktop-contract.js";

export function normalizeUpdatePreferences(value: unknown): UpdatePreferences {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    automaticChecks:
      typeof input.automaticChecks === "boolean" ? input.automaticChecks : true,
    ...(typeof input.skippedVersion === "string" &&
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?$/.test(input.skippedVersion)
      ? { skippedVersion: input.skippedVersion }
      : {}),
  };
}

export function updatePreferencesStore(directory: string) {
  const file = path.join(directory, "update-preferences.json");
  let preferences: UpdatePreferences;
  try {
    preferences = normalizeUpdatePreferences(
      JSON.parse(readFileSync(file, "utf8")),
    );
  } catch {
    preferences = { automaticChecks: true };
  }
  return {
    get: () => ({ ...preferences }),
    set(patch: unknown) {
      if (!patch || typeof patch !== "object") return { ...preferences };
      const next = normalizeUpdatePreferences({ ...preferences, ...patch });
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      preferences = next;
      return { ...preferences };
    },
  };
}
