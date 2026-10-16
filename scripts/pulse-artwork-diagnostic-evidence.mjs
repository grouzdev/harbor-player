// Allocator observations are not additive: parent/child and shared ownership
// overlap. Preserve Chromium's names, units and scalar encoding without totals.
export function parseArtworkMemoryTrace(trace) {
  const observations = [];
  for (const event of trace.traceEvents ?? []) {
    const dumps = event.args?.dumps;
    if (!dumps?.allocators) continue;
    for (const [name, allocator] of Object.entries(dumps.allocators)) {
      if (!/(image|skia|gpu|texture|discardable)/i.test(name)) continue;
      for (const [attribute, scalar] of Object.entries(allocator.attrs ?? {})) {
        if (scalar.type !== "scalar") continue;
        const raw = scalar.value;
        const valid =
          typeof raw === "string" && /^(?:0x)?[0-9a-f]+$/i.test(raw);
        observations.push({
          pid: event.pid,
          dumpId: event.id ?? event.id2 ?? null,
          timestamp: event.ts,
          name,
          attribute,
          units: scalar.units ?? null,
          rawHex: raw,
          // Decimal strings avoid rounding Chromium uint64 scalar values.
          decimal: valid
            ? BigInt(`0x${raw.replace(/^0x/i, "")}`).toString()
            : null,
        });
      }
    }
  }
  const byteObservations = observations.filter(
    (item) =>
      item.decimal !== null &&
      item.units === "bytes" &&
      ["size", "effective_size", "allocated_size", "resident_size"].includes(
        item.attribute,
      ),
  );
  return {
    status: byteObservations.length ? "MEASURED" : "NOT MEASURED",
    categories: Object.fromEntries(
      [
        ["image", /image/i],
        ["skia", /skia/i],
        ["gpu", /gpu|texture/i],
        ["discardable", /discardable/i],
      ].map(([category, pattern]) => [
        category,
        byteObservations.some((item) => pattern.test(item.name))
          ? "MEASURED"
          : "NOT MEASURED",
      ]),
    ),
    note: "Individual allocator scalars only; overlapping nodes must not be summed. GPU process working set is not VRAM.",
    observations,
  };
}
