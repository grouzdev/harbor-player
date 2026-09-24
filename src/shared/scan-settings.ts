import { z } from "zod";

export const autoScanIntervals = [0, 60, 15, 5] as const;

export const scanSettingsSchema = z
  .object({
    autoScanIntervalMinutes: z.union([
      z.literal(0),
      z.literal(5),
      z.literal(15),
      z.literal(60),
    ]),
  })
  .strict();

export type ScanSettings = z.infer<typeof scanSettingsSchema>;

export const defaultScanSettings: ScanSettings = {
  autoScanIntervalMinutes: 5,
};
