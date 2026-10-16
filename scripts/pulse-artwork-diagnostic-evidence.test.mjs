import assert from "node:assert/strict";
import test from "node:test";
import { parseArtworkMemoryTrace } from "./pulse-artwork-diagnostic-evidence.mjs";

test("retains allocator hierarchy, units and hexadecimal uint64 without summing", () => {
  const result = parseArtworkMemoryTrace({
    traceEvents: [
      {
        pid: 42,
        id: "dump",
        ts: 12,
        args: {
          dumps: {
            allocators: {
              skia: {
                attrs: {
                  size: { type: "scalar", units: "bytes", value: "100" },
                },
              },
              "skia/image": {
                attrs: {
                  size: {
                    type: "scalar",
                    units: "bytes",
                    value: "ffffffffffffffff",
                  },
                },
              },
              "gpu/textures": {
                attrs: {
                  count: { type: "scalar", units: "objects", value: "0xA" },
                },
              },
              malloc: {
                attrs: {
                  size: { type: "scalar", units: "bytes", value: "ff" },
                },
              },
            },
          },
        },
      },
    ],
  });
  assert.equal(result.status, "MEASURED");
  assert.deepEqual(
    result.observations.map((x) => x.decimal),
    ["256", "18446744073709551615", "10"],
  );
  assert.equal(result.observations[2].units, "objects");
  assert.equal(result.observations[0].pid, 42);
  assert.equal("total" in result, false);
  assert.equal(result.categories.image, "MEASURED");
  assert.equal(result.categories.gpu, "NOT MEASURED");
  assert.equal(result.categories.discardable, "NOT MEASURED");
});

test("object counts and invalid byte scalars do not establish memory measurement", () => {
  const result = parseArtworkMemoryTrace({
    traceEvents: [
      {
        args: {
          dumps: {
            allocators: {
              "gpu/textures": {
                attrs: {
                  count: { type: "scalar", units: "objects", value: "f" },
                  size: { type: "scalar", units: "bytes", value: "invalid" },
                },
              },
            },
          },
        },
      },
    ],
  });
  assert.equal(result.observations.length, 2);
  assert.equal(result.status, "NOT MEASURED");
  assert.equal(result.categories.gpu, "NOT MEASURED");
});

test("missing allocators are NOT MEASURED, never zero", () => {
  assert.equal(
    parseArtworkMemoryTrace({ traceEvents: [] }).status,
    "NOT MEASURED",
  );
});
