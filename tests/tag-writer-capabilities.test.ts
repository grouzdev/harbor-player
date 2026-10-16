import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MusicService } from "../src/server/service.js";
import { installedTagWriterVersion } from "../src/server/tag-writer-version.js";

vi.mock("../src/server/tag-writer-version.js", () => ({
  installedTagWriterVersion: vi.fn(),
}));

afterEach(() => vi.mocked(installedTagWriterVersion).mockReset());

it.each(["matching", "different", "unreadable"])(
  "preserves the safety report gate for a %s installed writer version",
  async (kind) => {
    const report = JSON.parse(
      await readFile("verification/tag-support.json", "utf8"),
    );
    const version = vi.mocked(installedTagWriterVersion);
    if (kind === "unreadable")
      version.mockRejectedValue(new Error("unreadable"));
    else
      version.mockResolvedValue(
        kind === "matching"
          ? report.writerVersion
          : `${report.writerVersion}-other`,
      );
    await mkdir(".test-data", { recursive: true });
    const root = await mkdtemp(
      path.resolve(".test-data", "writer-capabilities-"),
    );
    const service = new MusicService(root);
    try {
      await service.initialize();
      expect(service.capabilities).toEqual(
        kind === "matching"
          ? {
              writableFormats: report.formats
                .filter((format: { passed: boolean }) => format.passed)
                .map((format: { format: string }) => format.format),
              verificationDate: report.date,
            }
          : { writableFormats: [], verificationDate: null },
      );
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
