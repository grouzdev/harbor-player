import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Selection } from "../shared/contracts";
import type {
  EncodingAnalysis,
  EncodingChoice,
  EncodingRow,
} from "../shared/tag-encoding";
import { api, fieldLabels } from "./api";
import "./styles/tag-encoding.css";

export type EncodingSelections = Record<string, string | null>;
const rowKey = (row: EncodingRow) =>
  JSON.stringify([row.trackId, row.field, row.index, row.original]);

export function EncodingRepairPanel({
  selection,
  initial,
  onBack,
  onUse,
}: {
  selection: Selection;
  initial: EncodingSelections;
  onBack: () => void;
  onUse: (
    analysis: EncodingAnalysis,
    choices: EncodingChoice[],
    selections: EncodingSelections,
  ) => void;
}) {
  const [selections, setSelections] = useState(initial);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => backRef.current?.focus(), []);
  const analysis = useQuery({
    queryKey: ["tag-encoding", selection],
    queryFn: ({ signal }) =>
      api<EncodingAnalysis>(
        "/metadata/encoding/analyze",
        { selection },
        "POST",
        { signal },
      ),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const chosen = (row: EncodingRow) => {
    const key = rowKey(row);
    if (Object.hasOwn(selections, key)) {
      const value = selections[key];
      return row.candidates.some((candidate) => candidate.value === value)
        ? value
        : null;
    }
    return row.recommended === undefined
      ? null
      : row.candidates[row.recommended]?.value || null;
  };
  const choices = (analysis.data?.rows || []).flatMap((row) => {
    const value = chosen(row);
    return value === null ? [] : [{ row, value }];
  });
  return (
    <div
      className="encoding-repair"
      onKeyDown={(event) => {
        if (event.key === "Tab") event.stopPropagation();
      }}
    >
      <p className="hint">
        Сравните исходные и исправленные значения. Спорные варианты выбирайте
        вручную. Файлы изменятся после подтверждения общей операции.
      </p>
      {analysis.isPending && (
        <p role="status">Проверяем кодировку выбранных треков…</p>
      )}
      {analysis.error && (
        <p className="error-text" role="alert">
          {analysis.error.message}
        </p>
      )}
      {(analysis.error || !!analysis.data?.errors.length) && (
        <button
          className="button secondary"
          disabled={analysis.isFetching}
          onClick={() => void analysis.refetch()}
        >
          Повторить анализ
        </button>
      )}
      {!!analysis.data?.errors.length && (
        <div role="alert" className="error-text">
          {analysis.data.errors.map((error, index) => (
            <p key={index}>
              {error.path}: {error.message}
            </p>
          ))}
        </div>
      )}
      {analysis.data && !analysis.data.rows.length && (
        <p role="status">Предложений по исправлению кодировки нет.</p>
      )}
      {!!analysis.data?.rows.length && (
        <>
          <p role="status">
            Выбрано исправлений: {choices.length}. Треков:{" "}
            {new Set(choices.map(({ row }) => row.trackId)).size}.
          </p>
          <div className="encoding-table-scroll">
            <table className="encoding-table">
              <thead>
                <tr>
                  <th>Выбор</th>
                  <th>Трек / Поле</th>
                  <th>Было</th>
                  <th>Станет</th>
                </tr>
              </thead>
              <tbody>
                {analysis.data.rows.map((row) => {
                  const key = rowKey(row);
                  const value = chosen(row);
                  const label =
                    row.path +
                    ": " +
                    fieldLabels[row.field] +
                    (row.index === undefined
                      ? ""
                      : " (" + (row.index + 1) + ")");
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={"Исправить: " + label}
                          disabled={!row.candidates.length}
                          checked={value !== null}
                          onChange={(event) =>
                            setSelections((previous) => ({
                              ...previous,
                              [key]: event.target.checked
                                ? row.candidates[row.recommended ?? 0].value
                                : null,
                            }))
                          }
                        />
                      </td>
                      <td>
                        <strong>{row.title}</strong>
                        <span>{fieldLabels[row.field]}</span>
                        <small title={row.path}>{row.path}</small>
                      </td>
                      <td className="encoding-original">{row.original}</td>
                      <td>
                        <select
                          aria-label={"Вариант: " + label}
                          value={value ?? ""}
                          disabled={!row.candidates.length}
                          onChange={(event) =>
                            setSelections((previous) => ({
                              ...previous,
                              [key]: event.target.value || null,
                            }))
                          }
                        >
                          <option value="">Оставить исходное</option>
                          {row.candidates.map((candidate) => (
                            <option
                              key={candidate.value}
                              value={candidate.value}
                            >
                              {candidate.value} · {candidate.label}
                            </option>
                          ))}
                        </select>
                        <div className="encoding-result">
                          {value ?? row.original}
                        </div>
                        {row.warning && <small>{row.warning}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <footer className="modal-footer">
        <button ref={backRef} className="button secondary" onClick={onBack}>
          Назад
        </button>
        <button
          className="button primary"
          disabled={!analysis.data || analysis.isFetching}
          onClick={() => {
            if (!analysis.data) return;
            const selected = Object.fromEntries(
              analysis.data.rows.map((row) => [rowKey(row), chosen(row)]),
            );
            onUse(analysis.data, choices, selected);
          }}
        >
          Использовать исправления
        </button>
      </footer>
    </div>
  );
}
