import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultRecoverySettings,
  recoverySettingsSchema,
  type RecoverySettings,
} from "../shared/recovery-settings.js";

const settingsPath = (dataDir: string) =>
  path.join(dataDir, "recovery-settings.json");

export async function readRecoverySettings(
  dataDir: string,
): Promise<RecoverySettings> {
  try {
    return recoverySettingsSchema.parse(
      JSON.parse(await readFile(settingsPath(dataDir), "utf8")),
    );
  } catch {
    return defaultRecoverySettings;
  }
}

export async function writeRecoverySettings(
  dataDir: string,
  settings: RecoverySettings,
): Promise<RecoverySettings> {
  const saved = recoverySettingsSchema.parse(settings);
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath(dataDir), JSON.stringify(saved), "utf8");
  return saved;
}
