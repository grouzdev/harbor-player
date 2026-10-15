// Explicit local opt-in only. Returned evidence never contains source names.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Conservative original-input budgets: 16 MiB/file, 128 MiB/manifest.
// The long UI protocol retains 20 copies. Only explicit options override these;
// projected bytes exclude generated fixtures and filesystem allocation overhead.
export const DEFAULT_ARTWORK_LIMITS = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  retainedCopies: 20,
});

async function readBounded(file, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.length;
    assert(size <= limit, "Artwork input exceeds byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function assertArtworkRoot(root) {
  const base = path.resolve(".test-data");
  const destination = path.resolve(root);
  const relative = path.relative(base, destination);
  const parts = relative.split(path.sep);
  assert(
    !path.isAbsolute(relative) &&
      /^pulse-p1-ui-[\w-]+$/.test(parts[0]) &&
      parts.every((part) => part && part !== "." && part !== ".."),
    "Artwork requires an isolated UI fixture root",
  );
  await mkdir(base, { recursive: true });
  assert.equal(
    await realpath(base),
    base,
    "Fixture base must not be a symlink",
  );
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      assert(
        info.isDirectory() && !info.isSymbolicLink(),
        "Fixture ancestor must be a real directory",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  assert.equal(
    await realpath(destination),
    destination,
    "Fixture root must not be a symlink",
  );
  const covers = path.join(destination, "pulse-covers");
  await mkdir(covers, { recursive: true });
  assert(!(await lstat(covers)).isSymbolicLink(), "Cover directory symlink");
  return covers;
}

async function planArtwork(
  manifestPath = process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST,
  options = {},
) {
  const limits = { ...DEFAULT_ARTWORK_LIMITS, ...options };
  for (const key of Object.keys(DEFAULT_ARTWORK_LIMITS))
    assert(
      Number.isSafeInteger(limits[key]) && limits[key] > 0,
      "Artwork limits must be positive safe integers",
    );
  if (!manifestPath) return { inputs: [], totalInputBytes: 0, limits };
  let manifest;
  try {
    assert(!(await lstat(manifestPath)).isSymbolicLink());
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("Artwork manifest could not be read as local JSON");
  }
  assert(
    manifest !== null &&
      manifest.version === 1 &&
      manifest.permitted === true &&
      Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length <= 1000,
    "Artwork manifest requires version 1, permitted true, and 1–1000 files",
  );
  const base = path.dirname(path.resolve(manifestPath));
  try {
    assert((await realpath(base)) === base);
  } catch {
    throw new Error(
      "Artwork manifest directory must be accessible without symlinks",
    );
  }
  const inputs = [];
  let totalInputBytes = 0;
  for (const entry of manifest.files) {
    assert(
      typeof entry === "string" &&
        entry.length > 0 &&
        !path.isAbsolute(entry) &&
        !entry.includes("\\") &&
        !entry.includes(":") &&
        entry.split("/").every((part) => part && part !== "." && part !== ".."),
      "Artwork file must be a relative path without traversal",
    );
    let current = base;
    let size;
    try {
      for (const component of entry.split("/")) {
        current = path.join(current, component);
        assert(!(await lstat(current)).isSymbolicLink());
      }
      const info = await lstat(current);
      assert(info.isFile());
      size = info.size;
    } catch {
      throw new Error(
        "Artwork entry must be an existing regular non-symlink file",
      );
    }
    assert(
      size <= limits.maxFileBytes,
      "Artwork file exceeds per-file byte limit",
    );
    totalInputBytes += size;
    assert(
      Number.isSafeInteger(totalInputBytes) &&
        totalInputBytes <= limits.maxTotalBytes,
      "Artwork inputs exceed total byte limit",
    );
    inputs.push({ file: current, size });
  }
  assert(
    Number.isSafeInteger(totalInputBytes * limits.retainedCopies),
    "Artwork projected retained bytes exceed safe integer range",
  );
  return { inputs, totalInputBytes, limits };
}

// Path-free preflight evidence; this does not create roots, decode or copy files.
export async function inspectPermittedArtwork(
  manifestPath = process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST,
  options = {},
) {
  const plan = await planArtwork(manifestPath, options);
  return {
    fileCount: plan.inputs.length,
    totalInputBytes: plan.totalInputBytes,
    projectedRetainedBytes: plan.totalInputBytes * plan.limits.retainedCopies,
  };
}

export async function seedPermittedArtwork(
  root,
  manifestPath = process.env.HARBOR_PLAYER_UI_ARTWORK_MANIFEST,
  options = {},
) {
  if (!manifestPath)
    return {
      mode: "generated-only",
      provenance: "generated-fixture",
      files: [],
    };
  const plan = await planArtwork(manifestPath, options);
  const destination = await assertArtworkRoot(root);
  const files = [];
  for (const input of plan.inputs) {
    let bytes;
    try {
      // Bound reads even if an input grows after preflight. Never retain buffers
      // for more than one original; reject changed lengths before decoding.
      bytes = await readBounded(
        input.file,
        Math.min(input.size, plan.limits.maxFileBytes),
      );
      assert.equal(bytes.length, input.size);
    } catch {
      throw new Error(
        "Artwork input changed or could not be read within byte limit",
      );
    }
    let width = null;
    let height = null;
    let format = null;
    let decode = { status: "decoded", error: null };
    try {
      const metadata = await sharp(bytes).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      format = metadata.format ?? null;
      await sharp(bytes).raw().toBuffer();
    } catch {
      decode = { status: "error", error: "image-decode-failed" };
    }
    assert(
      format === null || format === "jpeg" || format === "png",
      "Artwork originals must be JPEG or PNG (cover API supported formats)",
    );
    const extension = format === "jpeg" ? "jpg" : "png";
    const id = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
    const target = path.join(destination, id);
    // Exclusive creation cannot follow a pre-existing destination symlink.
    try {
      await writeFile(target, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assert(!(await lstat(target)).isSymbolicLink(), "Cover file symlink");
      assert(
        (await readBounded(target, bytes.length)).equals(bytes),
        "Cover content mismatch",
      );
    }
    files.push({
      id,
      bytes: bytes.length,
      width,
      height,
      format,
      size: width ?? 0,
      status: decode.status === "decoded" ? "valid-permitted" : "corrupt",
      provenance: "explicit-permitted-local-manifest",
      decode,
    });
  }
  return {
    mode: "permitted-local",
    provenance: "explicit-permitted-local-manifest",
    decoder: "sharp-raw",
    totalInputBytes: plan.totalInputBytes,
    projectedRetainedBytes: plan.totalInputBytes * plan.limits.retainedCopies,
    files,
  };
}
