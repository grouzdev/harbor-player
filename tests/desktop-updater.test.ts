import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createUpdateLog,
  safeUpdateCode,
  safeUpdateDiagnostics,
} from "../src/desktop/update-log.js";
import {
  normalizeUpdatePreferences,
  updatePreferencesStore,
} from "../src/desktop/update-preferences.js";

describe("desktop updater diagnostics and preferences", () => {
  it("never retains raw errors, paths, URLs or credentials", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "harbor-update-"));
    try {
      const log = createUpdateLog(directory, "beta", "0.3.0-beta.3");
      log.write(
        "check-failed",
        1,
        Object.assign(
          new Error("https://user:secret@example.com/private /home/private"),
          { code: "ENOTFOUND" },
        ),
      );
      const text = readFileSync(log.file, "utf8");
      expect(text).toContain("code=ENOTFOUND");
      expect(text).toContain("currentVersion=0.3.0-beta.3");
      expect(text).not.toMatch(/secret|private|example/);
      expect(safeUpdateCode({ code: "token=secret" })).toBe("UNKNOWN");
      expect(
        safeUpdateDiagnostics({
          message:
            "HTTP error: 403 https://user:secret@github.com/private?token=secret Authorization: Bearer secret https://private.example.com/private",
        }),
      ).toBe("reason=access-denied http=403 hosts=github.com");
      expect(
        safeUpdateDiagnostics({
          message:
            "Cannot find beta.yml https://github.com/grouzdev/harbor-player/releases/download/v0.3.0-beta.4/beta.yml?token=secret",
          statusCode: 404,
        }),
      ).toBe(
        "reason=not-found http=404 hosts=github.com metadata=v0.3.0-beta.4/beta.yml",
      );
      expect(
        safeUpdateDiagnostics({
          message:
            'Cannot find latest.yml (https://github.com/grouzdev/harbor-player/releases/download/v0.3.0-beta.3/latest.yml): HttpError: 404 "method: GET"',
        }),
      ).toBe(
        "reason=not-found http=404 hosts=github.com metadata=v0.3.0-beta.3/latest.yml",
      );
      writeFileSync(log.file, "x".repeat(256 * 1024));
      log.write("check-start", 2);
      expect(readFileSync(`${log.file}.1`, "utf8")).toHaveLength(256 * 1024);
      expect(readFileSync(log.file, "utf8")).toContain("operation=2");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("persists preferences and safely handles invalid input", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "harbor-update-"));
    try {
      const store = updatePreferencesStore(directory);
      expect(store.get()).toEqual({ automaticChecks: true });
      store.set({ automaticChecks: false, skippedVersion: "0.3.0-beta.4" });
      expect(updatePreferencesStore(directory).get()).toEqual({
        automaticChecks: false,
        skippedVersion: "0.3.0-beta.4",
      });
      expect(store.set({ skippedVersion: "" })).toEqual({
        automaticChecks: false,
      });
      expect(
        normalizeUpdatePreferences({ skippedVersion: "https://secret" }),
      ).toEqual({ automaticChecks: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
