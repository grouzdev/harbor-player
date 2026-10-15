# Пульс: доработки P1 после первого этапа

План: [pulse-p1-followup-plan.md](../docs/pulse-p1-followup-plan.md).
База исходных изменений — `14b705b`; пользователь сохранил первый этап
в `37d0820` на `wip/pulse-p1-followup`. Завершение harness — `7374eb4`.
Raw evidence содержит SHA, dirty flag, source hashes и hash executable;
результат относится к конкретным артефактам, а не к будущей сборке.
Рабочая БД, обычный Electron profile и power settings не менялись.
Следующий этап на базе `b967ca6` записан отдельно:
[layout concurrency, Tab reentry, publication retries и новые проверки](pulse-p1-stage2.md).
Статусы ниже относятся к первому этапу; новая сводка не переписывает его evidence.

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

## Полный navigation и latency

Четыре команды выполнены последовательно с exit code 0; originals manifest
был отключён, использованы generated-only fixtures.
Логи: `.test-data/pulse-p1-ui-bWr26W/verification-{1,2,3,4}-*.log`
и соседние `.result`.

1. `npm run test:pulse:ui -- --electron`: 62 мин 54 с,
   `.test-data/pulse-p1-ui-sUpUa5/summary.json`.
   Каждый dataset прошёл 1800 секунд навигации. Ordinary: 22 644 points,
   max 5 days / 8 cards. Ten-year: 42 731 points, max 10 days / 16 cards.
   Все page limits соблюдены; longtask observer записал 0 entries.
   Старый collector захватывал также post-navigation idle/heap; в текущем
   коде добавлена точная renderer-clock граница конца navigation.
   Нулевые entries — наблюдение этого API, не гарантия GPU/frame smoothness.
2. `node scripts/pulse-ui-benchmark.mjs --latency-only --electron --cold=ready-panels`:
   `.test-data/pulse-p1-ui-bAFFfu`.
3. `node scripts/pulse-ui-benchmark.mjs --latency-only --channel=msedge --cold=ready-panels`:
   `.test-data/pulse-p1-ui-xvtIl5`.
4. `PULSE_BENCH_DAYS=365 npm run benchmark:pulse:ingest`:
   `.test-data/pulse-p1-ingest-Lwz1VM`.

Latency samples: по 10 cold, 30 warm-immediate и 41 return на dataset;
TTL/listening/clear/clear-recovery выполнены отдельными одиночными samples
без navigation/forced-GC. Это real HTTP над aggregate-seeded fixture,
не actual audio recorder.

| Foreground target / dataset | cold dataReady p95, мс | warm p95 | return p95 |
| --- | --- | --- | --- |
| Electron / ordinary | 75,3 | 36,3 | 29,3 |
| Electron / ten-year | 98,5 | 59,5 | 28,8 |
| Edge / ordinary | 453,5 | 36,0 | 28,7 |
| Edge / ten-year | 460,9 | 64,3 | 29,2 |

Native guide в этих условиях соблюдён. Edge cold outliers сохранены и
**не закрыты**; median 70,7/100,6 мс не заменяет p95.
Startup-overlap raw cold p95 631/634,8 мс также сохранены отдельно и
не выдаются за foreground first-entry.

## Память: выявлена инструментальная контаминация

В полном network-enabled ten-year профиле native private memory достигла
~1,1 GiB. После GC DOM Nodes 722 и JS heap 8 439 336 bytes, но heap содержит
469 273 `blink::NetworkResourcesData::ResourceData` / 135 150 624 self bytes.
Это удержание ресурсов сетевым инспектором; данный профиль **не доказывает**
утечку продукта или bounded native-memory acceptance.

Добавлен отдельный `test:pulse:memory`: main Node inspector, native inputs,
без Playwright, renderer debugger, Network domain и forced GC.
Он ждёт нормального native show и видимого готового UI, не форсирует ранний
show. Intermediate range targets задаются стандартным HTML setter/event
с native keyboard commit и проверкой достигнутой даты. Поток тысяч Arrow
без подтверждения значения удалён как недостоверный способ навигации.

- Native smoke `.test-data/pulse-p1-ui-memory-1wqRC5` — COMPLETED,
  оба dataset, без long acceptance.
- Точная команда `npm run test:pulse:memory` на `7374eb4` запущена в полном режиме.
  `.test-data/pulse-p1-ui-memory-vSYSK2/evidence.json` — **INCONCLUSIVE**.
  Ordinary: 971,699 с / 3694 settled targets; окно стало
  `visible=false`, `focused=false`, renderer `visibility=hidden`.
  Renderer private KiB: before 50 696, максимум 52 480, последний sample 51 160.
  Это частичный результат, не полчаса и не ten-year acceptance.
- Инструмент сохранил диагностику и завершил только собственное дерево PID.
  Ни throttling, ни power policy не отключались; hidden window не считается
  успешным foreground прогоном.

Предыдущие частичные попытки остаются INCONCLUSIVE, а не PASS.
Повтор после подтверждения оператора завершён ниже.

### Полный native-memory cohort: завершён

Точная команда `npm run test:pulse:memory` на `4e17de4` завершилась exit 0:
`.test-data/pulse-p1-ui-memory-Ciqug8/evidence.json`.
`status=COMPLETED`, `completed=true`, `longDurationCompleted=true`.
Свежая packaged Electron 44.4.1, Node 24.20.0; executable SHA-256:
`652255726053c45657d751eff7286257f2fa1f3bb1b6543f7ccbffe816c59357`.

| Dataset | Navigation, с | Settled targets | Контрольные samples | Max days/cards |
| --- | --- | --- | --- | --- |
| Ordinary | 1800,723 | 6824 | 122 | 5 / 8 |
| Ten-year, 1000 albums/day | 1803,245 | 5100 | 121 | 19 / 17 |

Во всех контрольных samples окно visible/focused, не minimized;
renderer debugger не подключён. Playwright, renderer Network domain и
forced GC не использовались. Достигнутые даты/sentinels и DOM envelope проверены.

Renderer private memory, **KiB**, не суммарная память всех процессов:

| Dataset | Before | End | После 10 с idle | Median Q1 / Q2 / Q3 / Q4 |
| --- | --- | --- | --- | --- |
| Ordinary | 50 272 | 53 348 | 53 312 | 51 312 / 52 496 / 52 900 / 52 940 |
| Ten-year | 55 008 | 132 876 | 84 704 | 122 788 / 126 756 / 129 104 / 129 520 |

Q1–Q4 — последовательные 7,5-минутные окна. Ordinary вышел на плато около
52–53 тысяч KiB. Ten-year после прогрева стабилизировался около 129 тысяч KiB:
median Q3 → Q4 вырос на 416 KiB, после idle освободилось 48 172 KiB относительно
end. Working set ten-year: before 109 352 KiB, end 222 080, idle 148 908;
peak 283 832 KiB.

**Вывод для проверенного сценария:** полный memory-замер закрыт; ранее
наблюдавшийся рост примерно до 1,1 GiB в Network-enabled профиле не повторился.
DOM и post-warmup memory остаются ограниченными в этом получасовом повторении.
Это не гарантия отсутствия любых утечек, не GPU-memory proof и не одинаковый
A/B тест: pace и состав действий двух harness различаются.
Уменьшение относительно Network-enabled профиля — изменение инструмента
измерения, не заявленная оптимизация продукта.

Raw `longAcceptance=false` сохранён: harness намеренно не принимает продукт
автоматически только по длительности. Вывод выше основан на просмотре тренда,
а не подмене этого флага. Реальные пользовательские изображения и installed
manual по-прежнему не проверены.

## Годовая модель

Реально overlapping read p95 **33,052 мс**, 1552 запроса; baseline **26,889 мс**.
Maximum observed synchronous segment **29,312 мс**, sampled loop max **39,780 мс**.
Во всех четырёх слоях final **2 667 886 000 мс** точно.
12 042 intervals, 3293 albums, 366 active days, 7661 day-albums.
SQLite после checkpoint **12 640 256 bytes**, WAL 0, peak sampled WAL
**4 614 432 bytes**. 2565 images / **26 360 745 bytes**, staging 0.
Это accelerated 365-дневная модель с обычными revisions и отдельным paced
сегментом, не год наблюдения playback.

## Итоговая проверка WIP-ветки

`main` оставлен на `690afd0`; merge/push/публикация не выполнялись.

| Проверка | Результат |
| --- | --- |
| `npm test` | PASS: 49 файлов, 397 тестов |
| `npm run build` / typecheck | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `git diff --check` | PASS |
| `npm run test:e2e` | Chrome 140/140; общая команда прервана во время Edge №49 |
| `npx playwright test --project=edge` | PASS: полный Edge 140/140 на неизменённом UI-коде |
| `npm run test:pulse:desktop` | PASS, свежая packaged-сборка |
| `npm run test:desktop:smoke` | PASS |
| `npm run test:pulse:process` | PASS: Chrome + Edge |
| `npm run test:pulse:memory` | COMPLETED: оба dataset ≥1800 с; предыдущие потерявшие foreground попытки — INCONCLUSIVE |

Прерванный Edge №49 содержал только `Target page, context or browser has been
closed`; оставшихся тестовых процессов не было. Это не assertion failure;
timeouts/skip не менялись. Полный последующий Edge прошёл.
Не объявлять, что точная общая `test:e2e` команда завершилась exit 0.

Desktop evidence `.test-data/pulse-desktop-yWGyi2`: checkpoint 15 009 мс
восстановлен точно; crash tail ~4366 мс; pending replay once; два playback
сеанса, точная сумма 82 915 мс.
Process evidence `.test-data/pulse-process-3g5uWm`: суммы 33 011 мс Chrome /
33 158 мс Edge.

Также исправлена selected cover recovery: ошибка старого URL не оставляет
новую картинку скрытой; ресурсный key меняется вместе с URL.
Регрессия реального API + управляемого image HTTP проверена в обоих браузерах.
Тест явно переходит к исторической дате и нажимает painted time, не drag zone.

## Что не закрыто

- Cold outliers Edge и отдельная установленная manual приёмка.
- Настоящие permitted изображения, image/GPU memory, physical touch/trackpad/FAT.
- Совместная непрерванная `npm run test:e2e`, новый CI на финальном SHA и
  проверки после будущего merge с изменившимся `main`.
- Staging recovery остаётся отдельным follow-up: накопление staging в текущих
  моделях не обнаружено; retention опубликованных ресурсов не добавлялся.

P0 sleep закрыт; recorder не менялся. Релизный gate не закрыт.
