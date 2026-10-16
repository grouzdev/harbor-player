import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  assertArtworkRoot,
  inspectPermittedArtwork,
  seedPermittedArtwork,
} from "../scripts/pulse-artwork-fixture.mjs";
import { seedUiDataset } from "../scripts/pulse-ui-dataset.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

const roots: string[] = [];
async function fixture() {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data/pulse-p1-ui-artwork-"));
  roots.push(root);
  const manifest = path.join(root, "private-manifest.json");
  return { root, manifest };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("explicit permitted artwork fixture", () => {
  it("rejects a per-file excess before creating cover copies", async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, "small.png"), Buffer.alloc(5));
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["small.png"],
      }),
    );
    await expect(
      seedPermittedArtwork(root, manifest, {
        maxFileBytes: 4,
      }),
    ).rejects.toThrow("per-file byte limit");
    await expect(lstat(path.join(root, "pulse-covers"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects aggregate excess before copying any entry and reports safe projections", async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, "one.png"), Buffer.alloc(3));
    await writeFile(path.join(root, "two.png"), Buffer.alloc(3));
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["one.png", "two.png"],
      }),
    );
    await expect(
      seedPermittedArtwork(root, manifest, {
        maxFileBytes: 3,
        maxTotalBytes: 5,
      }),
    ).rejects.toThrow("total byte limit");
    await expect(lstat(path.join(root, "pulse-covers"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await inspectPermittedArtwork(manifest, {
        maxFileBytes: 3,
        maxTotalBytes: 6,
      }),
    ).toEqual({
      fileCount: 2,
      totalInputBytes: 6,
      projectedRetainedBytes: 120,
    });
    const summary = await seedPermittedArtwork(root, manifest, {
      maxFileBytes: 3,
      maxTotalBytes: 6,
      retainedCopies: 2,
    });
    expect(summary.totalInputBytes).toBe(6);
    expect(summary.projectedRetainedBytes).toBe(12);
  });

  it("sanitizes raw manifest-directory realpath errors", async () => {
    const { root, manifest } = await fixture();
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["image.png"],
      }),
    );
    vi.mocked(fs.realpath).mockRejectedValueOnce(
      new Error(`EACCES: private manifest directory ${root}`),
    );
    await expect(inspectPermittedArtwork(manifest)).rejects.toThrow(
      /^Artwork manifest directory must be accessible without symlinks$/,
    );
  });

  it.each([0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe explicit limits %s",
    async (maxFileBytes) => {
      await expect(
        inspectPermittedArtwork("", { maxFileBytes }),
      ).rejects.toThrow("positive safe integers");
    },
  );

  it("supports the nested dataset roots used by the real UI harness", async () => {
    const { root } = await fixture();
    const data = path.join(root, "ordinary-0-owned", "data");
    const manifest = await seedUiDataset(data, "ordinary");
    expect(manifest.busyCount).toBe(6);
    expect(manifest.covers.artwork.mode).toBe("generated-only");
  });

  it("supports the isolated process originals root, not arbitrary test directories", async () => {
    await mkdir(".test-data", { recursive: true });
    const root = await mkdtemp(path.resolve(".test-data/pulse-process-unit-"));
    roots.push(root);
    const originals = path.join(root, "originals");
    expect(await assertArtworkRoot(originals)).toBe(
      path.join(originals, "pulse-covers"),
    );
    await expect(
      assertArtworkRoot(path.resolve(".test-data/arbitrary-originals")),
    ).rejects.toThrow("isolated UI or process fixture root");
  });

  it("rejects an ancestor junction before creating descendants through it", async () => {
    const { root } = await fixture();
    const { root: other } = await fixture();
    await symlink(other, path.join(root, "linked"), "junction");
    await expect(
      assertArtworkRoot(path.join(root, "linked", "new-data")),
    ).rejects.toThrow("real directory");
    await expect(lstat(path.join(other, "new-data"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("defaults to generated-only without discovering files", async () => {
    expect(await seedPermittedArtwork("unused", "")).toEqual({
      mode: "generated-only",
      provenance: "generated-fixture",
      files: [],
    });
  });

  it("copies generated test images through the permitted manifest, not user artwork", async () => {
    const { root, manifest } = await fixture();
    const bytes = await sharp({
      create: { width: 13, height: 17, channels: 3, background: "blue" },
    })
      .jpeg()
      .toBuffer();
    await writeFile(path.join(root, "private-name.jpg"), bytes);
    await writeFile(path.join(root, "broken.png"), "not an image");
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["private-name.jpg", "broken.png"],
      }),
    );
    const summary = await seedPermittedArtwork(root, manifest);
    expect(summary.mode).toBe("permitted-local");
    expect(summary.files[0]).toMatchObject({
      bytes: bytes.length,
      width: 13,
      height: 17,
      format: "jpeg",
      decode: { status: "decoded", error: null },
    });
    expect(summary.files[1].decode).toEqual({
      status: "error",
      error: "image-decode-failed",
    });
    expect(
      await readFile(path.join(root, "pulse-covers", summary.files[0].id)),
    ).toEqual(bytes);
    expect(JSON.stringify(summary)).not.toContain("private-name");
    expect(JSON.stringify(summary)).not.toContain(root);
  });

  it.each(["../outside.png", "/outside.png", "C:\\private.png", "a/../b.png"])(
    "rejects unsafe manifest entry %s",
    async (entry) => {
      const { root, manifest } = await fixture();
      await writeFile(
        manifest,
        JSON.stringify({ version: 1, permitted: true, files: [entry] }),
      );
      await expect(seedPermittedArtwork(root, manifest)).rejects.toThrow(
        "relative path",
      );
    },
  );

  it("requires explicit permission and valid JSON", async () => {
    const { root, manifest } = await fixture();
    await writeFile(manifest, "{");
    await expect(seedPermittedArtwork(root, manifest)).rejects.toThrow(
      "local JSON",
    );
    await writeFile(
      manifest,
      JSON.stringify({ version: 1, files: ["image.png"] }),
    );
    await expect(seedPermittedArtwork(root, manifest)).rejects.toThrow(
      "permitted true",
    );
    await expect(assertArtworkRoot(".test-data/not-ui")).rejects.toThrow(
      "isolated",
    );
  });

  it("rejects unsupported originals instead of publishing an invalid API ID", async () => {
    const { root, manifest } = await fixture();
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .webp()
      .toFile(path.join(root, "image.webp"));
    await writeFile(
      manifest,
      JSON.stringify({ version: 1, permitted: true, files: ["image.webp"] }),
    );
    await expect(seedPermittedArtwork(root, manifest)).rejects.toThrow(
      "JPEG or PNG",
    );
  });

  it("reports a missing source without exposing its private name or path", async () => {
    const { root, manifest } = await fixture();
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["private-missing-original.png"],
      }),
    );
    let message = "";
    try {
      await seedPermittedArtwork(root, manifest);
    } catch (error: any) {
      message = error.message;
    }
    expect(message).toBe(
      "Artwork entry must be an existing regular non-symlink file",
    );
    expect(message).not.toContain(root);
    expect(message).not.toContain("private-missing");
  });

  it("seeds the ordinary dataset with generated, corrupt, missing and permitted covers", async () => {
    const { root, manifest } = await fixture();
    await sharp({
      create: { width: 9, height: 11, channels: 3, background: "green" },
    })
      .png()
      .toFile(path.join(root, "test-generated.png"));
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["test-generated.png"],
      }),
    );
    const previous = process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST;
    process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST = manifest;
    try {
      const result = await seedUiDataset(root, "ordinary");
      expect(result.covers).toMatchObject({ valid: 4, corrupt: 1, missing: 1 });
      expect(result.covers.artwork.files).toHaveLength(1);
      expect(result.covers.files).toHaveLength(5);
    } finally {
      if (previous === undefined)
        delete process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST;
      else process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST = previous;
    }
  });

  it("rejects a symlinked source directory", async (context) => {
    const { root, manifest } = await fixture();
    await mkdir(path.join(root, "source"));
    try {
      await symlink(
        path.join(root, "source"),
        path.join(root, "link"),
        "junction",
      );
    } catch (error: any) {
      if (error.code === "EPERM") return context.skip();
      throw error;
    }
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        permitted: true,
        files: ["link/image.png"],
      }),
    );
    await expect(seedPermittedArtwork(root, manifest)).rejects.toThrow(
      "non-symlink",
    );
  });
});
