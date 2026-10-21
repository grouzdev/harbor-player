import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { repairCandidates } from "../src/server/tag-encoding.js";
import {
  encodingPatches,
  mergeEncodingPatches,
  type EncodingAnalysis,
} from "../src/shared/tag-encoding.js";

const corrupt = (text: string, from = "windows-1251", to = "latin1") =>
  iconv.decode(iconv.encode(text, from), to);

describe("reversible Cyrillic tag repair", () => {
  it.each([
    ["Привет", "windows-1251", "latin1"],
    ["Любимые песни", "windows-1251", "windows-1252"],
    ["Звёздная ночь", "utf8", "windows-1251"],
    ["Привет", "utf8", "windows-1252"],
    ["Привет", "utf8", "latin1"],
  ])("recommends %s decoded as %s → %s", (text, from, to) => {
    const result = repairCandidates(corrupt(text, from, to));
    expect(result.candidates[result.recommended!]?.value).toBe(text);
    expect(new Set(result.candidates.map(({ value }) => value)).size).toBe(
      result.candidates.length,
    );
  });
  it("reverses two rounds without expanding to unlimited chains", () => {
    const text = "Привет";
    const result = repairCandidates(
      corrupt(corrupt(text, "utf8", "windows-1251"), "utf8", "windows-1251"),
    );
    expect(result.candidates.some(({ value }) => value === text)).toBe(true);
    for (const candidate of result.candidates)
      expect(candidate.label.split("; ").length).toBeLessThanOrEqual(2);
  });
  it.each([
    "Нормальный альбом",
    "СССР",
    "Beyoncé",
    "François",
    "Sigur Rós",
    "Álbum",
    "AC/DC",
    "Солнце / Live 2025",
    "Ólafur Arnalds",
  ])("does not recommend changes to %s", (text) => {
    expect(repairCandidates(text).recommended).toBeUndefined();
  });
  it("keeps short values manual and refuses lost characters", () => {
    const result = repairCandidates(corrupt("Мир"));
    expect(result.candidates.some(({ value }) => value === "Мир")).toBe(true);
    expect(result.recommended).toBeUndefined();
    expect(repairCandidates("П�ивет")).toMatchObject({
      candidates: [],
      warning: expect.stringContaining("потеряна"),
    });
  });
  it("keeps ASCII within mixed strings and never offers new controls or replacement characters", () => {
    const result = repairCandidates(corrupt("Привет / Live 2025"));
    expect(result.candidates[result.recommended!]?.value).toBe(
      "Привет / Live 2025",
    );
    for (const { value } of result.candidates)
      expect(
        Array.from(value).some((letter) => {
          const code = letter.codePointAt(0)!;
          return code < 32 || (code >= 127 && code <= 159) || code === 65533;
        }),
      ).toBe(false);
  });
});

describe("individual encoding patches", () => {
  const analysis: EncodingAnalysis = {
    tracks: [
      {
        trackId: "one",
        values: {
          title: "Ïåñíÿ",
          albumTitle: "Àëüáîì",
          artists: ["Öîé", "Beyoncé", "Êèíî"],
          albumArtists: [],
          genres: ["Rock"],
        },
      },
      {
        trackId: "two",
        values: {
          title: "Íî÷ü",
          albumTitle: "",
          artists: [],
          albumArtists: [],
          genres: [],
        },
      },
    ],
    rows: [],
    errors: [],
  };
  const row = (
    trackId: string,
    field: "title" | "artists",
    original: string,
    index?: number,
  ) => ({
    trackId,
    field,
    index,
    original,
    title: trackId,
    path: trackId + ".mp3",
    candidates: [],
  });
  it("preserves individual titles and unselected list elements", () => {
    const patches = encodingPatches(analysis, [
      { row: row("one", "title", "Ïåñíÿ"), value: "Песня" },
      { row: row("two", "title", "Íî÷ü"), value: "Ночь" },
      { row: row("one", "artists", "Öîé", 0), value: "Цой" },
      { row: row("one", "artists", "Êèíî", 2), value: "Кино" },
    ]);
    expect(patches).toEqual({
      one: { title: "Песня", artists: ["Цой", "Beyoncé", "Кино"] },
      two: { title: "Ночь" },
    });
    expect(analysis.tracks[0].values.artists).toEqual([
      "Öîé",
      "Beyoncé",
      "Êèíî",
    ]);
  });
  it("uses manual > encoding > MusicBrainz and removes empty patches", () => {
    expect(
      mergeEncodingPatches(
        {
          one: { title: "MB", artists: ["MB"], year: 2000 },
          two: { title: "MB2" },
        },
        { one: { title: "Песня", artists: ["Цой"] }, two: { title: "Ночь" } },
        new Set(["title"]),
      ),
    ).toEqual({ one: { artists: ["Цой"], year: 2000 } });
  });
});
