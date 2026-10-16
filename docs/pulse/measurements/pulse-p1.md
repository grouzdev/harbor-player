# Пульс P1: журнал реализации и проверок

Текущая реализация доработок и новые измерения:
[журнал follow-up](pulse-p1-followup.md).
Приведённые ниже числа относятся к первому этапу; native cold затем
уточнён как startup/pre-show cohort, не foreground first entry.

Исторический журнал P1. Старый план заменён
[roadmap](../../pulse-roadmap.md); разделы о следующих работах ниже
описывают состояние на момент измерений, а не текущий backlog.
Это журнал фактов, не разрешение на релиз. Отсутствующая проверка — `NOT RUN`.
Рабочая пользовательская БД не использовалась для seed, очистки или нагрузки.

## Windows CI

- Исходный [run 38293801848](https://github.com/grouzdev/harbor-player/actions/runs/38293801848)
  на `ffff20e`: ошибка подготовки `tests/pulse-migration.test.ts`,
  `git ls-tree 72403c6…` → `fatal: not a tree object`.
  Результат: 344 passed, три миграционных теста не выполнились.
- `d81279f`: `actions/checkout@v4` получает полную историю (`fetch-depth: 0`).
  Миграционные регрессии не отключены.
- Локально: `git cat-file -e 72403c6…^{tree}`,
  `npm run build:server`, `npx vitest run tests/pulse-migration.test.ts` —
  успешно, 3/3.
- На момент исходной работы новый GitHub `verify`: **NOT RUN**, push не выполнялся.
  Позднее [run 38303905680](https://github.com/grouzdev/harbor-player/actions/runs/38303905680)
  на `0fcb964` завершился успешно. Он не проверяет последующие коммиты.

## Исходный локальный прогон до UI-изменений

Windows, Node `v24.20.0`, npm `11.19.0`; база кода `d81279f`.

| Команда | Результат |
| --- | --- |
| `npm test` | PASS: 44 файла, 347 тестов |
| `npm run build` | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | FAIL: прежние четыре файла |

Format baseline: `src/client/pulse-layout.ts`, `src/server/app.ts`,
`src/server/catalog-migrations.ts`, `src/server/database.ts`.
Сравнение с выводом Prettier не выявило содержательных изменений;
Git сообщил о CRLF → LF. Это локальный baseline окончания строк,
не новая ошибка исходных изменений и не доказательство зелёного format gate.

## Остальная приёмка

| Область | Статус |
| --- | --- |
| Новые UI-regressions Chrome + Edge | PASS в итоговом полном прогоне |
| Полный итоговый `npm run test:e2e` | PASS: 134/134 Chrome + 134/134 Edge |
| Production UI benchmark, samples/DOM/requests/longtask | PARTIAL: smoke + latency-only; cold budget не достигнут |
| Ingest, влияние на каталог и рост storage | PARTIAL: финальная 30-дневная модель ниже |
| Установленный Electron: ручной checklist | NOT RUN |
| Настоящий trackpad/touch и Ctrl+wheel zoom | NOT RUN |
| Физический sleep/wake P0 | PASS в отдельной работе, evidence в журнале P0 |

Новые результаты добавляются после соответствующего прогона на новой сборке.

## Асинхронная подготовка исторических обложек

Измерение старого синхронного пути выявило блокировку: на батче 100 новых
интервалов с впервые копируемыми обложками filesystem calls доминировали
над SQLite. Подготовка переведена на асинхронный I/O с общей очередью
по четыре операции на store и дедупликацией cover ID. Полная частная копия
публикуется без перезаписи существующей исторической обложки; мусор staging
удаляется после операции. Поколение/enable/timeZone перепроверяются после
ожидания внутри той же SQLite-транзакции.

Первый родительский прогон до финального directory publication:

```sh
npm run build:server
npx vitest run tests/pulse.test.ts tests/pulse-ingest-evidence.test.ts
npm run benchmark:pulse:ingest
```

- 30/30 целевых тестов после добавления regression отвергнутой preparation;
  адресные ESLint/Prettier успешно.
- Evidence: `.test-data/pulse-p1-ingest-vBjrxf/result.json`.
- Каталог baseline p95: **42,047 мс**; во время ingest:
  **35,016 мс**, max **42,435 мс** (480 реально перекрывающихся запросов).
- Максимальная наблюдаемая транзакция/синхронный участок: **41,850 мс**;
  sampled event-loop delay max **42,828 мс**. Это измеренные границы данного
  прогона, не гарантия любого устройства или любой нагрузки.
- **Цена изменения:** первый HTTP ingest 100 новых обложек занял **1944,951 мс**,
  из них awaiting preparation/residual **1896,465 мс**.
  Блокировка event loop устранена, но полный ACK не ускорился.
  Обложки по-прежнему подготавливаются до ACK; скрытую background copy после
  ACK не вводили, чтобы не менять сохранность исторического изображения.
- Точные суммы raw/day/day-album/stats: **230 476 000 мс** во всех слоях.
- 30-дневная модель: 1145 intervals, 436 albums; SQLite после checkpoint
  **1 847 296 байт**, WAL **0**, sampled peak WAL **4 313 672 байта**;
  313 исторических обложек, **3 221 317 байт**.
- Новые тесты evidence перенесены в обычный Vitest suite:
  они выполняются через `npm test`, а не только отдельной Node-командой.

Модель использует настоящие HTTP/SQLite и 15-секундную wall-clock паузу,
но не является actual audio/recorder integration. Синтетические solid PNG
не доказывают скорость копирования/декодирования пользовательских оригиналов.
Годовой прогон после async-изменения и окончательная idle-проверка —
**NOT RUN**. Другие worker-процессы могли работать на том же ПК;
этот результат нельзя объявлять окончательной target-device приёмкой.

## Read benchmark и процессная надёжность после ingest-фикса

Точная команда `npm run build:server && node scripts/pulse-benchmark.mjs`
успешна: 1 000 000 интервалов, 10 000 альбомов, 3634 активных дня,
1000 альбомов в busy day, SQLite 498,1 MiB. Полный JSON/query plans —
в выводе команды этой ветки.

| Read SQLite + JSON | median, мс | p95, мс |
| --- | --- | --- |
| range | 0,938 | 1,950 |
| year layout | 0,457 | 0,712 |
| week window | 1,230 | 2,483 |
| busy-day rank 900 | 0,510 | 0,939 |
| album stats | 0,112 | 0,379 |

Query plans используют индексы dayKey, `pulse_day_albums_order` и albumId.
Это не HTTP/UI/paint benchmark.

`npm run test:pulse:process` прошёл **Chrome + Edge**:
настоящий отказ/перезапуск собственного API, два playback окна,
checkpoint/final/retry, точные суммы 33 517 мс и 33 326 мс.
Evidence `.test-data/pulse-process-1uWSlI`.
Прогон выполнен после ingest-фикса, но до последующих UI/desktop-изменений;
не является итоговым прогоном всей последней сборки и не проверяет sleep/wake.

## Итоговая версия и проверки

Исходные изменения закоммичены раздельно:

- `d81279f`: Git history для old-code миграционной фикстуры в Windows CI.
- `e8ff50d`: async artwork preparation и атомарные archives.
- `74ec606`: согласованная виртуальная геометрия, логическая клавиатурная
  навигация, generation/state/focus, compact layout и регрессии.
- `b8c1e01`: изолированные измерительные harness и их unit evidence.

Финальная подготовка обложек не использует hard links. Новые полные изображения
публикуются в непустом `${coverId}.archive/image` через directory rename,
который не заменяет непустого победителя. Старые плоские копии продолжают
читаться. Это устраняет зависимость от hard-link capability FAT/exFAT.
Каталог текущих обложек имеет прежний приоритет в API. Тесты проверяют
конкурентную публикацию, сохранение первого изображения, API после удаления
текущего кэша, staging cleanup и ACK старой плоской копии при занятой copy queue.
Физический тест FAT/exFAT не выполнялся.

Финальные команды на общей версии `b8c1e01`:

| Команда | Результат |
| --- | --- |
| `npm test` | PASS: 47 файлов, 367 тестов |
| `npm run build` | PASS, в том числе build в полном e2e и desktop pack |
| `npm run lint` | PASS |
| `npm run format:check` | PASS, весь репозиторный набор |
| `npm run test:e2e` | PASS: 134/134 Chrome + 134/134 Edge, без фильтров/skip |
| `git diff --check` | PASS |
| `npm run test:pulse:desktop` | PASS на свежем packaged Electron 44.4.1 |
| `npm run test:desktop:smoke` | PASS |
| `npm run test:pulse:process` | PASS: Chrome + Edge |

Старый локальный format baseline был только CRLF: окончания строк нормализованы
согласно `.gitattributes`, без содержательных изменений трёх оставшихся файлов.
Build сообщает предупреждение о JS chunk > 500 kB: основной chunk 603,31 kB /
179,59 kB gzip. Пульс импортируется явно вместо click-time lazy/Suspense;
это убирает отдельную отложенную загрузку модуля, но **не доказывает**
достижения cold budget.

Новые UI tests проверяют каждый из 1000 ranks/ID клавиатурой, мышь,
resize и bounded DOM; clear при unmount и in-flight, LRU/TTL/epoch invalidation,
settings/диалог focus, loading/empty/disabled и pointer cancellation/capture loss.
Геометрия проверена на 390/640/800/1366/1600 × 480/900 и 390×844.
Скриншоты всех тем/accent/длинных имён и настоящий physical input этим не закрыты.

Итоговая процессная evidence: `.test-data/pulse-process-jyFKyb`;
точные принятые суммы 33 291 мс Chrome и 33 199 мс Edge.
Desktop evidence: `.test-data/pulse-desktop-OPGAi6`;
14 981 мс checkpoint восстановлены точно, хвост ~4,205 с;
pending replay принят ровно один раз; два реально проигрывающих окна,
два события/сеанса, точная сумма 68 020 мс.

## Финальный UI measurement

Harness измеряет renderer clock от реального click; readiness подтверждается
после последующих RAF с перепроверкой карточек/статистики и декодированных
изображений. Это rendering opportunity, не аппаратная presentation timestamp.
Manifest/sentinel, диапазон, порядок, totals и representative stats проверяются
через реальный API **после cold sample**, чтобы не прогреть его SQLite/statement
cache предварительной проверкой. Ошибочный fixture делает run incomplete.
Electron executable hash, actual build info, userData/sessionData записаны;
benchmark mode отключает updater/tray и не трогает обычный профиль.

Прогоны:

```sh
npm run test:pulse:ui -- --smoke --channel=chrome
npm run test:pulse:ui -- --latency-only --channel=chrome
npm run test:pulse:ui -- --smoke --electron
npm run test:pulse:ui -- --latency-only --electron
```

- Chrome smoke: `.test-data/pulse-p1-ui-wTrlGg`, оба dataset, navigation trace.
- Chrome latency-only: `.test-data/pulse-p1-ui-OMiXO9`.
- Свежий packaged Electron smoke: `.test-data/pulse-p1-ui-P4YvsN`,
  оба dataset, переходы по годам и navigation trace.
- Packaged Electron latency-only: `.test-data/pulse-p1-ui-5c2gWd`.
- Полные latency counts: 10 cold, 30 warm, 41 return для каждого dataset;
  один дополнительный warm sample после TTL > 30 с.

| Target / dataset | cold dataReady p95, мс | warm p95, мс | return p95, мс |
| --- | --- | --- | --- |
| Chrome / ordinary | 537,1 | 51,7 | 34,8 |
| Chrome / ten-year | 555,1 | 80,1 | 39,6 |
| Packaged Electron / ordinary | 780,9 | 46,3 | 32,3 |
| Packaged Electron / ten-year | 760,2 | 74,6 | 31,9 |

**Cold guide < 300 мс не достигнут.** Smoke cold иногда значительно быстрее,
но полный p95 нельзя заменять этим одним sample. Тёплый вход/возврат
в данных прогонах укладываются в 100 мс. Нужен следующий profiling cold
renderer/paint path; медленные reads SQLite этими результатами не доказаны.
Browser числа — диагностика; packaged не заменяет установленную ручную приёмку.

Не выполнены: полный default harness с 30 минутами navigation на каждый dataset,
полные профили памяти/image/GPU и permitted реальных обложек, отдельный UI
benchmark Edge, warm после listening/clear, установленный manual checklist.
Существующие browser tests clear/listening не выдаются за эти latency samples.

## Финальный ingest measurement

`npm run benchmark:pulse:ingest` на финальном async/archive пути — успешно.
Evidence `.test-data/pulse-p1-ingest-F1AvDp/result.json`:

- Baseline каталога p95 **32,645 мс**; loaded/реально overlapping p95
  **36,999 мс**, max **64,529 мс**, 480 перекрывающихся запросов.
- Maximum observed synchronous segment **40,170 мс**;
  sampled event-loop delay max **54,166 мс**. Полный event-loop budget
  и отсутствие всех long tasks этим не подтверждаются.
- Самый долгий HTTP ACK: first-copy/new, 100 events, **1492,070 мс**;
  transaction **36,221 мс**, awaited preparation/residual **1435,909 мс**.
  Не объявлять эту latency непрерывной блокировкой или ускорением полного ACK.
- Суммы raw/day/day-album/stats строго **230 476 000 мс**.
- SQLite после checkpoint **1 855 488 байт**, WAL **0**;
  sampled peak WAL **4 309 552 байта**.
- 313 опубликованных обложек / **3 221 317 байт**, staging entries **0**.
  Collector считает image bytes внутри archives, а не размеры директорий.

Модель 30 дней, 2 ч/день, треки 3/4/5 минут, 20% новых альбомов/обложек
и обычные cumulative revisions. Это не месяц наблюдений actual audio.
365-дневная модель после финального изменения **NOT RUN**.

## Оставшиеся работы

Актуальный исходный HEAD для доработок — `14b705b`.
Исторический порядок доработок заменён
[текущими этапами](../../pulse-next-steps.md).

- Cold renderer/paint профиль и устранение причины отклонения бюджета.
- Полный navigation/memory/artwork protocol и ручная установленная приёмка.
- GitHub `verify` на финальном SHA после доработок; `0fcb964` уже зелёный.
- Физический sleep/wake P0 закрыт отдельным реальным S3-прогоном:
  [результаты](pulse-p0.md#физический-sleepwake-pass), commit `14b705b`.
- Follow-up: восстановление/консервативная уборка owned staging после crash
  или Windows sharing errors. Обычный `finally` не гарантирует cleanup при kill;
  не удалять staging другого живого процесса и не смешивать это с retention
  опубликованных исторических изображений.

P1 и общий релизный gate не закрыты. Релиз/публикация не выполнялись.

## Ручная приёмка установленного приложения

Подготовка сеанса на Feather: существующие библиотека и профиль тестовые,
пользователь разрешил clear/error-сценарии без отдельного профиля.
Рабочие данные на VLVY не трогать. FAT/exFAT — NOT RUN, согласованный пропуск.
Доставка следующей беты через updater разрешена после проверок и CI.
Установленная версия, её hashes и ручные результаты ниже пока NOT RUN.

Локальный gate кандидата `0.3.0-beta.5` на `cdebb0c` + dirty
version/docs/tag-verification changes (Node 24.20.0, npm 11.19.0, Windows):
`npm run fixtures`, `npm run verify:tags`, `npm test` (63 файла / 478 тестов),
`npm run build`, `npm run lint`, `npm run format:check`,
`npm run test:e2e` (144 Chrome + 144 Edge, без filters/skip),
`npm run desktop:pack`, `npm run test:desktop:smoke`, `git diff --check` —
все exit 0. Предупреждение Vite о chunk > 500 kB сохраняется.
Это локальная packaged automation, не результат установленной приёмки.

Заполнять на целевом Windows-ПК после последнего изменения. Packaged automation
сама по себе не закрывает этот раздел. Не менять рабочую БД для ошибок/clear:
эти действия проверять в отдельном тестовом data dir и profile.

Окружение: версия/build ID, Windows/Electron, путь к установленному executable,
DPI/zoom, CSS viewport, доступные мышь/trackpad/touch — **NOT RUN**.

Перед прогоном записать идентичность **согласованной установленной** сборки.
Не подставлять SHA/hash последнего `win-unpacked` вместо реально установленного
артефакта. Установка и доступ к permitted originals требуют отдельного согласования.

| Поле | Значение |
| --- | --- |
| Версия, build ID, source SHA | NOT RUN |
| SHA-256 установленного executable | NOT RUN |
| Windows/Electron | NOT RUN |
| DPI, zoom, CSS viewport и размеры окна | NOT RUN |
| Тема и accent | NOT RUN |
| Доступные устройства ввода | NOT RUN |
| Изолированный test data dir/profile для clear/error сценариев | NOT RUN |
| Локальный evidence и разрешённый artwork manifest | NOT RUN |

Автоматическая поддержка есть, но не заменяет ручной результат:
`tests/browser/pulse.spec.ts` — transitions/focus/states/geometry и generated
artwork; `tests/browser/player-value-bubble.spec.ts` — общие player controls;
native-memory и ingest reports — отдельные нагрузочные cohorts.
Для каждого ручного результата записать фактические шаги, окружение и наблюдение,
а не только ссылку на успешный browser test.

| Сценарий | Статус | Evidence/замечания |
| --- | --- | --- |
| Панели → Пульс → панели; focus/scroll и playback/queue | NOT RUN | |
| Пульс → обложка → Пульс; сохранённая date/selection | NOT RUN | |
| Общие настройки/диалог истории; Escape только верхнего диалога | NOT RUN | |
| Tab/Shift+Tab, focus ring, скрытые панели и hotkeys | NOT RUN | |
| Низкое и portrait окно; видимы статистика, лента и годы | NOT RUN | |
| Fullscreen, DPI и zoom; отсутствие обрезанных controls | NOT RUN | |
| Light/dark и custom accent; без окраски выходных | NOT RUN | |
| Длинные title/artist и empty/disabled состояния | NOT RUN | |
| API errors/retry, missing/corrupt cover, смена выбранного artwork | NOT RUN | |
| Общие player controls/value bubbles, seek/volume без прерывания playback | NOT RUN | |
| Trackpad: инерция, горизонтальные/вертикальные delta, границы | NOT RUN | |
| Touch-pan и отмена жеста при наличии устройства | NOT RUN | |
| Ctrl+wheel оставлен масштабированию Chromium/Electron | NOT RUN | |

Для недоступного устройства записать причину, не ставить PASS по mouse emulation.
