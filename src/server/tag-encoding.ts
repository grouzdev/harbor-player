import iconv from "iconv-lite";
import path from "node:path";
import { parseFile } from "music-metadata";
import type { Selection } from "../shared/contracts.js";
import {
  encodingFields,
  type EncodingAnalysis,
} from "../shared/tag-encoding.js";
import type { MusicService } from "./service.js";

const encodings = ["windows-1251", "utf8", "windows-1252", "latin1"] as const;
const names = {
  "windows-1251": "Windows-1251",
  utf8: "UTF-8",
  "windows-1252": "Windows-1252",
  latin1: "ISO-8859-1",
};
function hasControls(value: string) {
  return Array.from(value).some((letter) => {
    const code = letter.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) || code === 65533;
  });
}
// A small conservative ranking heuristic, not language detection: reversibility
// alone can also turn valid Latin text into Cyrillic-looking nonsense.
const bigrams = new Set(
  "ст но то на ен ов ни ра во ко ро по ос ал ли ре от ол ан ер ор та ка ла те ел ит ет ар ил де ва не ин ти пр ве ог од ми об со до ис за ло ес мо ма ри ая ый ой нн ск ие ак да се ле ек ме че ьн ье ья ий ше жи чи ча щи тр кр гр др сл св зв сп пл бл кл лу си му зы ык би ви ди ги пи ту ру ду бу ну гу жу ща це ем ом ам ям аю ую ые им ым вы ты мы бы ды ры сы ны ки ги хи ци ба бе бо аб ав аг ад аж аз ай ас ат ау ах ач аш".split(
    " ",
  ),
);

function damage(value: string): number {
  const western =
    value.match(
      /[\u00c0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e]{3,}/gu,
    ) || [];
  const markers = value.match(/(?:[РС][^\s]){2,}|[ÐÑÃÂ][^\s]/gu) || [];
  return (
    western.reduce((sum, part) => sum + part.length, 0) +
    markers.reduce((sum, part) => sum + part.length, 0)
  );
}

function russianQuality(value: string) {
  const letters = value.match(/[А-Яа-яЁё]/gu) || [];
  if (
    !letters.length ||
    /[\u0400\u0402-\u040f\u0450\u0452-\u045f]/u.test(value)
  )
    return 0;
  const text = value.toLowerCase();
  const vowels =
    letters.filter((letter) => /[аеёиоуыэюя]/u.test(letter.toLowerCase()))
      .length / letters.length;
  if (
    vowels < 0.15 ||
    vowels > 0.65 ||
    /[бвгджзйклмнпрстфхцчшщ]{5}/u.test(text)
  )
    return 0;
  let hits = 0;
  for (let index = 0; index < text.length - 1; index++)
    if (bigrams.has(text.slice(index, index + 2))) hits++;
  return hits / Math.max(1, letters.length - 1);
}

export function repairCandidates(original: string) {
  if (original.includes("\ufffd"))
    return {
      candidates: [],
      warning:
        "В тексте есть �: часть символов потеряна, автоматическое восстановление недоступно.",
    };
  if (!damage(original)) return { candidates: [] };
  const seen = new Set([original]);
  let frontier = [{ value: original, steps: [] as string[] }];
  const found: {
    value: string;
    label: string;
    quality: number;
    steps: number;
  }[] = [];
  for (let depth = 0; depth < 2; depth++) {
    const next: typeof frontier = [];
    for (const current of frontier) {
      for (const from of encodings) {
        const bytes = iconv.encode(current.value, from);
        if (iconv.decode(bytes, from) !== current.value) continue;
        for (const to of encodings) {
          if (from === to) continue;
          const value = iconv.decode(bytes, to);
          if (
            !iconv.encode(value, to).equals(bytes) ||
            value.includes("\ufffd") ||
            seen.has(value)
          )
            continue;
          seen.add(value);
          const steps = [...current.steps, names[from] + " → " + names[to]];
          next.push({ value, steps });
          if (
            value.length <= original.length &&
            /[А-Яа-яЁё]/u.test(value) &&
            !hasControls(value) &&
            damage(value) < damage(original)
          )
            found.push({
              value,
              label: steps.join("; "),
              quality: russianQuality(value),
              steps: steps.length,
            });
        }
      }
    }
    frontier = next;
  }
  found.sort(
    (a, b) =>
      b.quality - a.quality ||
      a.steps - b.steps ||
      a.value.localeCompare(b.value),
  );
  const best = found[0];
  const recommended =
    best &&
    !damage(best.value) &&
    (best.value.match(/[А-Яа-яЁё]/gu)?.length || 0) >= 4 &&
    best.quality >= 0.35 &&
    (!found[1] || best.quality - found[1].quality >= 0.2)
      ? 0
      : undefined;
  return {
    candidates: found.map(({ value, label }) => ({ value, label })),
    recommended,
    warning: !found.length
      ? "Не удалось подобрать обратимое исправление."
      : recommended === undefined
        ? "Проверьте результат и выберите вариант вручную."
        : undefined,
  };
}

/** Read original tags, never catalog fallbacks or cached/normalised display values. */
export async function analyzeTagEncoding(
  service: Pick<MusicService, "catalog" | "safePath" | "capabilities">,
  selection: Selection,
): Promise<EncodingAnalysis> {
  const result: EncodingAnalysis = { tracks: [], rows: [], errors: [] };
  for (const track of service.catalog.selected(selection)) {
    try {
      if (!service.capabilities.writableFormats.includes(track.format))
        throw new Error(
          "Запись этого формата не прошла проверку безопасности.",
        );
      const library = service.catalog.library(track.libraryId);
      if (!library.available) throw new Error("Библиотека недоступна.");
      const file = path.join(library.path, track.relativePath);
      await service.safePath(file);
      const { common: c } = await parseFile(file, { skipCovers: true });
      const values = {
        title: c.title || "",
        artists: c.artists || (c.artist ? [c.artist] : []),
        albumTitle: c.album || "",
        albumArtists: c.albumartists || (c.albumartist ? [c.albumartist] : []),
        genres: c.genre || [],
      };
      result.tracks.push({ trackId: track.id, values });
      for (const field of encodingFields) {
        const value = values[field];
        const entries = typeof value === "string" ? [value] : value;
        entries.forEach((original, index) => {
          const proposal = repairCandidates(original);
          if (!proposal.candidates.length && !proposal.warning) return;
          result.rows.push({
            trackId: track.id,
            title: values.title || track.relativePath,
            path: track.relativePath,
            field,
            index: typeof value === "string" ? undefined : index,
            original,
            ...proposal,
          });
        });
      }
    } catch (error) {
      result.errors.push({
        path: track.relativePath,
        message:
          error instanceof Error ? error.message : "Не удалось прочитать теги.",
      });
    }
  }
  return result;
}
