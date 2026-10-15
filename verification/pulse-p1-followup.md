# Пульс: доработки P1 после первого этапа

План: [pulse-p1-followup-plan.md](../docs/pulse-p1-followup-plan.md).
База исходных изменений — `14b705b`, доработки пока в working tree.
Raw evidence содержит SHA, dirty flag, source hashes и hash executable;
результат относится к конкретным артефактам, а не к будущей сборке.
Рабочая БД, обычный Electron profile и power settings не менялись.

## D1: уточнение cold measurement

Старый native cold запускал CDP click до физической готовности окна:
DOM visibility не доказывает `BrowserWindow.isVisible()`.

- `.test-data/pulse-p1-ui-JlpYUW`: при attach оба native окна были
  `visible=false`, `focused=false`.
- В медленном ten-year sample: Pulse shell DOM **3,6 мс**, API/stats около
  **65 мс**, первый наблюдённый RAF **618,8 мс**, dataReady **646 мс**.
- Main lifecycle: did-finish-load **734,2 мс**, client-first-raf **1680,4 мс**,
  ready-to-show **1687,1 мс**, show **1706,9 мс** от собственного main clock.
  Эти часы не вычитались из renderer timestamps.
- Browser trace `.test-data/pulse-p1-ui-OomnUp`: RAF requested около **28 мс**,
  fired около **514 мс** от click, без соответствующего renderer long task.
  Это не доказательство медленного SQLite или вычисления React длиной 486 мс.

Сохранены два отдельных cohort:

1. `startup-overlap`: ранняя диагностическая инъекция, в том числе до native
   show; raw latency сохраняется, foreground guide к ней не применяется.
2. `ready-panels`: первый вход после готовности панелей и видимого/focused
   native окна. Pulse API/module/cache специально не прогреваются.

Для readiness используется реальный `aria-busy` каталога, fonts, renderer
focus/visibility и native state; browser network listeners установлены до goto.
Проверяются семантика cards/selection/stats между RAF, а не только node identity.
Hidden frames и stale empty selection не принимаются за готовое состояние.
Это исправление измерительного протокола, **не заявление об ускорении продукта**.

Свежий packaged smoke после review:
`.test-data/pulse-p1-ui-bWr26W/summary.json`.
Native до команды `visible=true`, `focused=true`, `minimized=false`;
foreground cold dataReady: **60,3 мс ordinary**, **99,0 мс ten-year**.
Это по одному sample, не p95 acceptance.

## D3: missing-source fast path

Перед созданием staging проверяется source. Отсутствие не кешируется:
при появлении файла retry сохраняет image; исчезновение после проверки
обрабатывается best-effort с cleanup и без потери listening time.
Pre-ACK barrier, queue 4, immutable archives, атомарная SQLite-транзакция,
generation recheck и идемпотентность сохранены.

Диагностические before/after:
`.test-data/pulse-p1-ingest-tOFPeW/result.json`,
`.test-data/pulse-p1-ingest-xQ14iB/result.json`,
сводка всех сценариев `.test-data/d3-comparison.json`.
Три повтора каждой из 45 комбинаций 1/20/100 × first-copy/existing/missing ×
new/checkpoint/final/retry/old-checkpoint.

| HTTP ACK, мс | До median / p95 | После median / p95 |
| --- | --- | --- |
| 1 missing/new | 48,41 / 65,14 | 32,13 / 34,91 |
| 20 missing/new | 220,54 / 300,34 | 127,07 / 152,13 |
| 100 missing/new | 598,99 / 764,61 | 212,57 / 241,88 |
| 100 first-copy/new | 859,72 / 881,53 | 936,09 / 1190,75 |

Missing staging/copy/cleanup исключены. Общего first-copy ускорения или
отсутствия регрессии не заявляем; tuning concurrency не сохраняли.
Overlapping catalog read p95: **31,94 → 32,96 мс**.
Во всех слоях обеих моделей ровно **255 886 000 мс**, 555 images /
5 707 719 bytes, staging 0. Generated PNG; n=3, p95 равен max,
инструментированный worker добавляет overhead.

## D4: безопасные artwork и memory evidence

Опциональный `HARBOR_PLAYER_UI_ARTWORK_MANIFEST` указывает на локальный JSON:

```json
{"version": 1, "permitted": true, "files": ["image.jpg", "subdirectory/image.png"]}
```

Пути относительны manifest directory; symlinks/traversal/unsupported formats
отклоняются. Только JPEG/PNG originals, максимум 16 MiB/file и 128 MiB total
по умолчанию. Обработка последовательная; preflight учитывает retained copies
(20 для полного прогона) плюс 2 GiB свободного места для evidence.
В отчётах — hashes/bytes/resolution/sanitized decode, не private filenames.
Sharp decode не подменяет browser decode. Raw originals, traces и heaps
остаются локальными; в shared journal переносить только безопасные агрегаты.
Реальные permitted пользовательские изображения **NOT RUN**.

Navigation записывает bounded DOM/pages, memory before/plateau/idle,
отдельные forced-GC heaps до/после; forced GC не входит в latency samples.
Trace — ограниченные start/end windows, завершающиеся до idle/heap;
потеря trace данных делает profile incomplete. Незавершённый heap не получает
валидное `.heapsnapshot` имя. Native memory — working/private/peak KiB,
не image/GPU/VRAM. Mutation latency собирается отдельно через `--latency-only`.

## Проверки и текущий статус

- Build/typecheck, 55 focused tests до последних review-уточнений — PASS.
- После review: UI evidence 6/6, artwork 20/20; полный format check — PASS.
- Свежие `desktop:pack` и native foreground smoke с heaps — PASS.
- Длительный `npm run test:pulse:ui -- --electron` — **IN PROGRESS**,
  отдельная видимая задача `Run full Pulse follow-up verification`.
- Следом в той же последовательной задаче: foreground native latency,
  Edge latency, 365-дневная модель.
- Итоговые full tests/build/lint/e2e/process/desktop — **NOT RUN**
  после последних изменений; выполняются после длительного прогона.
- Installed/manual, physical input/FAT и настоящие пользовательские обложки —
  **NOT RUN**. P0 sleep закрыт; recorder не менялся.

Замечание для анализа long tasks: raw navigation collector пока захватывает
также idle/последующий heap diagnostic. Проверять хронологию по points/trace;
не объявлять эти записи автоматически scrolling defects или clean budget.
Точный конец окна измерения требует отдельного уточнения после frozen run.

Релизный gate не закрыт; публикация не выполнялась.
