import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultScanSettings,
  scanSettingsSchema,
  type ScanSettings,
} from "../shared/scan-settings.js";

const settingsPath = (dataDir: string) =>
  path.join(dataDir, "scan-settings.json");

export async function readScanSettings(dataDir: string): Promise<ScanSettings> {
  try {
    return scanSettingsSchema.parse(
      JSON.parse(await readFile(settingsPath(dataDir), "utf8")),
    );
  } catch {
    return defaultScanSettings;
  }
}

export async function writeScanSettings(
  dataDir: string,
  settings: ScanSettings,
): Promise<ScanSettings> {
  const saved = scanSettingsSchema.parse(settings);
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath(dataDir), JSON.stringify(saved), "utf8");
  return saved;
}
