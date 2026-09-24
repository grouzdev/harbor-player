import { z } from "zod";

export const backupRetentionSchema = z.enum(["none", "1d", "7d", "never"]);
export type BackupRetention = z.infer<typeof backupRetentionSchema>;

export const recoverySettingsSchema = z
  .object({ backupRetention: backupRetentionSchema })
  .strict();
export type RecoverySettings = z.infer<typeof recoverySettingsSchema>;

export const defaultRecoverySettings: RecoverySettings = {
  backupRetention: "none",
};

export const recoveryStatusSchema = recoverySettingsSchema.extend({
  size: z.number().int().nonnegative(),
  hasFiles: z.boolean(),
});
export type RecoveryStatus = z.infer<typeof recoveryStatusSchema>;
