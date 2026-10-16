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

### Интеграция актуального main в beta-кандидат

По разрешению пользователя `origin/main` (`690afd0`) объединён только в
релизную ветку, merge commit `6086c60`; удалённый main не менялся.
Исходный PR CI [38939739148](https://github.com/grouzdev/harbor-player/actions/runs/38939739148)
на `b532389` — FAIL: старый unit test ожидал удалённые album actions.
Тест адаптирован к indicators на обложке без возврата старого интерфейса.

После merge fixtures/tags, 478 unit tests, build/lint/format — exit 0.
Первый полный `npm run test:e2e`: Chrome 153/156, Edge не запущен
из-за `&&`. Исправлены устаревшие ожидания кнопок плейлиста и неравных
ширин панелей, отдельный fixture `catalog-state` устраняет повторное
подключение папки из search test. Следующий Chrome 155/156 выявил
неоднозначный locator при анимации закрытия: проверки теперь адресуют
живые `data-panel-id`, а не декоративные clones, и ждут удаления snapshot.

Последний полный `npm run test:e2e` на `6086c60` + dirty test/fixture changes:
**Chrome 156/156 PASS, Edge 155/156 FAIL**. В длинном `local library`
сценарии после сброса album selection нажатие пункта «Добавить в закладки»
не приводит к появлению индикатора. Menu остаётся открыт; POST bookmarks
в trace для этого действия отсутствует. Причина не установлена.
Адресные проверки с настоящим right-click, ожиданием idle и явным
`MouseEvent` не устранили отказ; диагностические изменения helper отменены,
не заменять настоящий click синтетическим ради PASS.
Часть ошибочно параллельно запущенных диагностических попыток завершилась
ошибками подготовки общего fixture (ENOENT/ENOTEMPTY); это не новые
продуктовые дефекты и не результаты приёмки.
Локальный последний trace сохранён в
`.test-data/pulse-beta-5-integration/edge-menu-trace.zip`.

**Публикация beta.5 заблокирована полным e2e.** Desktop pack/smoke после
merge не выполнены: цепочка остановилась на e2e. Предыдущий packaged PASS
до merge не переносится на этот кандидат. Нужна адресная диагностика
Edge menu/input после сброса selection; timeout/skip не изменялись.

### Продолжение: Edge input и повторный release gate

Блокер выше снят на `a41812c` + dirty CSS/regression/tag-verification changes.
Диагностическая кнопка вне каталога показала: после двух настоящих
Control-click по изображению обложки Edge перестаёт доставлять pointer/click
события всей странице, а не только пункту bookmarks. До этой пары кликов
обычный ввод работает; pointer capture не остаётся активным. Замена
жизненного цикла Modal на layout effect не помогла и отменена.
Это согласуется с нативным
[Edge Magnify](https://www.microsoft.com/en-us/edge/features/magnify):
двойной Ctrl над изображением включает браузерный просмотр.

Исправлено правило hit testing: декоративные `.album-cover > img` и
`.tiny-cover > img` имеют `pointer-events: none`; действия, selection и
cover drop принадлежат родительским controls. Браузерные настройки/feature
flags не отключались. С этим изменением адресный Edge-сценарий прошёл.
В длинный regression добавлены настоящие click открытия и закрытия
add-library dialog сразу после пары Control-click; bookmark click также
остался настоящим. Диагностические probes удалены.

Итоговые команды на Windows, Node 24.20.0 / npm 11.19.0, version beta.5:
`npm run fixtures`, `npm run verify:tags`, `npm test` (63 / 478),
`npm run build`, `npm run lint`, `npm run format:check`,
**`npm run test:e2e` (156 Chrome + 156 Edge, полный, без filters/skip)**,
`npm run desktop:pack` (Electron 44.4.1), `npm run test:desktop:smoke`,
`git diff --check` — все exit 0. Предупреждение chunk > 500 kB сохраняется.
Ошибочная параллельная диагностическая попытка сборки также дала
`Build marker ... was not found` из-за общего dist; итоговый gate выше
выполнен последовательно. Результаты прежних FAIL не удалены.
Публикация ещё требует CI на финальном commit и успешного release workflow;
установленная ручная приёмка Feather пока NOT RUN.

### Кандидат 0.4.0-beta.1

По решению пользователя новая важная фича Pulse повышает minor:
следующий выпуск — `0.4.0-beta.1`, не stable. Неопубликованный кандидат
`0.3.0-beta.6` заменён до создания тега.

CI [38950664427](https://github.com/grouzdev/harbor-player/actions/runs/38950664427)
на `ccd6e97` — PASS, но release
[38951382487](https://github.com/grouzdev/harbor-player/actions/runs/38951382487)
на теге `v0.3.0-beta.5` — FAIL до создания GitHub release:
Chrome 155/156, пункт viewed остаётся disabled после завершения rating POST.
Тег не перемещать; beta.5 не опубликована.

Причина: открытое меню сохраняло snapshot `pendingUserStateKeys`.
Rating/viewed используют live disabled guards на существующем pending ref;
ContextMenu вычисляет их на каждом render, включая submenu. Управляемый
regression удерживает настоящий `/catalog-user-state` запрос, проверяет
оба disabled пункта до ACK и enabled после ACK без переоткрытия меню.
На старом dist — RED, после сборки исправления — PASS Chrome + Edge.

Во время следующего полного прогона найден неоднозначный locator в
playlist automatic-next test: `Song 1` совпадал с `Song 10` и с повтором
в другой playlist entry. Теперь выбирается точное название первой
(folder) occurrence. Адресный тест — PASS Chrome + Edge.
Полные попытки с этим прежним locator дали Chrome 155/156; Edge не
запускался из-за `&&`. Ещё один полный прогон был прерван пользователем
при смене версии до завершения Chrome; это не PASS.
Итоговый локальный gate `0.4.0-beta.1` на `ccd6e97` + dirty
menu/version/regression/docs/tag-verification changes:
`npm run fixtures`, `npm run verify:tags`, `npm test` (63 файла / 478),
`npm run build`, `npm run lint`, `npm run format:check`,
`npm run test:e2e` (156 Chrome + 156 Edge, без filters/skip),
`npm run desktop:pack`, `npm run test:desktop:smoke`, `git diff --check`,
`node scripts/verify-release.mjs v0.4.0-beta.1 --channel=beta` —
все exit 0. CI и публикация нового тега пока не подтверждены.

### Кандидат 0.4.0-beta.2: live bookmark menu

PR CI [38956709158](https://github.com/grouzdev/harbor-player/actions/runs/38956709158)
на `092cf3d` — PASS. Release
[38957346874](https://github.com/grouzdev/harbor-player/actions/runs/38957346874)
для beta.1 — FAIL до публикации: Chrome 156/156, Edge 155/156,
после optimistic bookmark отсутствует пункт «Удалить из закладок».
Открытое меню сохраняло pending label; disabled-only fix не покрывал label.
Тег beta.1 не перемещался; следующий кандидат — beta.2.

Bookmark item теперь resolve-ится на render целиком (label/icon/disabled/action)
по актуальному query cache и pending ref. Управляемый тест держит bookmark
POST, открывает меню в pending-состоянии, затем проверяет переход к enabled
«Удалить из закладок» без переоткрытия. Адресный Chrome + Edge — PASS.
Локальный gate на `092cf3d` + dirty menu/version/regression/docs changes:
fixtures/tags, 478 unit tests, build/lint/format, полный
`npm run test:e2e` (156 Chrome + 156 Edge), desktop:pack и desktop smoke,
`git diff --check` — все exit 0. CI и публикация beta.2 ещё не подтверждены.
Установленная приёмка Feather всё ещё NOT RUN.

### Опубликована 0.4.0-beta.2

Source/tag: `4058653ebacf8311b4449e452532833d11eaf50d`,
`v0.4.0-beta.2`. [PR CI 38961672607](https://github.com/grouzdev/harbor-player/actions/runs/38961672607)
и [release workflow 38962345930](https://github.com/grouzdev/harbor-player/actions/runs/38962345930)
— SUCCESS. Release workflow выполнил fixtures/tags, unit tests,
полный Chrome + Edge e2e, desktop pack/smoke, NSIS + portable dist,
portable smoke и проверку updater artifacts до публикации.

[GitHub prerelease](https://github.com/grouzdev/harbor-player/releases/tag/v0.4.0-beta.2)
не draft; опубликованы Setup.exe, blockmap, portable.exe и beta.yml.
`gh release download v0.4.0-beta.2 --pattern '*Setup.exe'` скачал
публичный установщик во временный локальный каталог. Python hashlib:
размер **130082461 байт**, SHA-256
`1bf998106d8a1eb2d94471c2202d682c30a69726df2252b08d50966bc1a8d45c`.
SHA-256 совпал с GitHub asset digest; SHA-512 и размер — с опубликованным
`beta.yml`, который указывает `version: 0.4.0-beta.2` и существующий Setup.
Это identity установщика, не установленного EXE/app.asar.

`main` не изменён (остаётся `690afd0`); релиз опубликован из
`release/pulse-beta-5`. Последующие docs-only commits не входят в тег.
Следующий шаг оператора: на Feather записать старую версию, выполнить
проверку обновлений, скачать и подтвердить установку beta.2, проверить
новую версию и сохранность тестовой библиотеки. Actual updater/installation,
hashes установленного EXE/app.asar и ручной checklist — **NOT RUN**.

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
| Версия, build ID, source SHA | Feather: установленный app.asar package.json — 0.4.0-beta.2; dist/desktop/main.js buildCommit — 4058653, соответствует release source |
| SHA-256 установленного executable | 20ba1bed9edbd360e8f52e0777b6de63f288ede6645cd99012387bbd05dc62d5 |
| SHA-256 установленного app.asar | c7d65c8eb360a64981bb33ae0dbbb088038b7365bafc43a16118892cb555a2c9 |
| Windows/Electron | Windows 11 Pro x64, 25H2, 10.0.26200.9711; установленный renderer userAgent: Electron 44.4.1 / Chrome 152.0.7977.78 |
| DPI, zoom, CSS viewport и размеры окна | Windows display scale 125% по сообщению оператора; zoom/viewport/размеры окна ещё не сняты |
| Тема и accent | NOT RUN |
| Доступные устройства ввода | Feather: только физический тачпад; мыши и touch screen нет |
| Изолированный test data dir/profile для clear/error сценариев | Согласован существующий тестовый профиль Feather; рабочий профиль VLVY не используется |
| Локальный evidence и разрешённый artwork manifest | NOT RUN |

Автоматическая поддержка есть, но не заменяет ручной результат:
`tests/browser/pulse.spec.ts` — transitions/focus/states/geometry и generated
artwork; `tests/browser/player-value-bubble.spec.ts` — общие player controls;
native-memory и ingest reports — отдельные нагрузочные cohorts.
Для каждого ручного результата записать фактические шаги, окружение и наблюдение,
а не только ссылку на успешный browser test.

| Сценарий | Статус | Evidence/замечания |
| --- | --- | --- |
| Панели → Пульс → панели; focus/scroll и playback/queue | PARTIAL | Feather 0.4.0-beta.2: оператор подтвердил сохранение выделения/scroll, трека/очереди и непрерывность playback при повторных переходах; keyboard focus отдельно NOT RUN |
| Пульс → обложка → Пульс; сохранённая date/selection | PASS | Feather beta.2: оператор подтвердил сохранение дня/альбома после перехода в обложку и обратно |
| Общие настройки/диалог истории; Escape только верхнего диалога | PARTIAL | Возврат из общих настроек в Пульс PASS; Escape закрывает только диалог очистки, следующий Escape возвращает каталог PASS; общий диалог операций/истории отдельно NOT RUN |
| Tab/Shift+Tab, focus ring, скрытые панели и hotkeys | PARTIAL, согласованный перенос | Оператор: вертикальные стрелки скроллят список, горизонтальные не действуют; Escape из настроек не возвращает каталог. Пользователь не считает это блокерами, hotkeys откладываются, Tab-навигацию планирует убирать; focus ring/restore не подтверждены |
| Низкое и portrait окно; видимы статистика, лента и годы | PARTIAL | Feather: оператор уменьшил окно до разрешённого приложением минимума, выглядит нормально; треть высоты и узкий portrait недостижимы из-за min size, оценены оператором как не проблема |
| Fullscreen, DPI и zoom; отсутствие обрезанных controls | PARTIAL | Блок resize/fullscreen при Windows scale 125% принят оператором «в целом всё ок»; точные размеры и Chromium zoom отдельно не сняты |
| Light/dark и custom accent; без окраски выходных | NOT RUN | По сообщению оператора переключение тем отключено ещё до Pulse; результат resize не считается PASS тем/accent |
| Длинные title/artist и empty/disabled состояния | NOT RUN | |
| API errors/retry, missing/corrupt cover, смена выбранного artwork | PASS, installed automation | Feather, установленная beta.2, отдельный профиль и synthetic history: API 503/retry, cover 404/corrupt PNG, затем выбор исправной обложки; snapshots просмотрены агентом. Не физическое повреждение файлов и не ручной результат оператора |
| Общие player controls/value bubbles, seek/volume без прерывания playback | PASS | Feather beta.2: оператор подтвердил блок 4 — seek/volume работают, громкость не останавливает playback, всплывающие значения не обрезаются |
| Trackpad: инерция, горизонтальные/вертикальные delta, границы | PASS | Feather beta.2, физический тачпад, 19 альбомов: оператор подтвердил вертикальные/горизонтальные жесты с инерцией и drag без залипания; только этот небольшой набор, не busy-day нагрузка |
| Touch-pan и отмена жеста при наличии устройства | NOT RUN | На Feather нет touch screen; тачпад не заменяет touch |
| Ctrl+wheel оставлен масштабированию Chromium/Electron | NOT RUN | На Feather только тачпад; жест pinch не выдаётся за физическое Ctrl+wheel |

Для недоступного устройства записать причину, не ставить PASS по mouse emulation.

### Feather: начало установленной приёмки

Оператор grouzdev сообщил из Feather: исходная установленная версия —
`0.3.0-beta.4`; штатное обновление выполнено, видимых проблем не обнаружено.
История Pulse пуста, что оператор считает ожидаемым. Это не очистка
существовавшей истории и не доказательство работы recorder.
Штатное обновление — PASS по наблюдению оператора. Затем оператор подтвердил
отображаемую версию `0.4.0-beta.2`, наличие тестовой библиотеки и
воспроизведение треков после обновления. Это не побайтовая проверка библиотеки.
Feather: только тачпад, Windows display scale 125%.
Build ID и hashes установленного EXE/app.asar сняты ниже после ручного сеанса.
Ручные результаты отражаются по блокам ниже и в таблице.

Блок 1 — PASS по подтверждению оператора «да всё норм»: после инструкции
включить сбор, проиграть трек около минуты без seek, прокрутить каталог,
повторить панели → Пульс → панели, поставить на паузу и открыть Пульс.
Подтверждены непрерывность playback без перезапуска, сохранение трека/очереди
и выделения/scroll каталога, появление сегодняшнего альбома с ненулевым
временем. Точное время не измерялось; focus и идемпотентность записи этим
блоком не проверены.

Блок 2 — оператор подтвердил «все ок»: Пульс → обложка → Пульс
с сохранением выбранных дня/альбома, возврат из общих настроек в Пульс.
Диалог очистки отменён первым Escape без закрытия Пульса; второй Escape
без диалога вернул каталог. Очистка не подтверждалась.

Блок 3 — оператор сообщил «в целом всё ок» на доступных размерах окна
и fullscreen при display scale 125%. Уменьшить до трети высоты либо
узкого portrait не получилось: минимальный размер ограничен приложением,
на доступном минимуме выглядит нормально. Оператор не считает ограничение
проблемой; обход min size не выполнялся. Light/dark не прогонялись:
по сообщению оператора переключение тем отключено ранее, до Pulse.
Отдельного подтверждения custom accent нет.

Блок 4 — оператор подтвердил «все ок, 19 альбомов»: прокрутка физическим
тачпадом вверх/вниз и влево/вправо, быстрые жесты с инерцией, выбор альбома,
drag с зажатой основной кнопкой и повторный выбор после отпускания;
громкость без остановки playback, seek и необрезанные value bubbles.
Границы оценивались на имеющихся 19 альбомах, не на большой истории.
Touch и Ctrl+wheel этим не проверены.

Блок 5 — не PASS. Оператор сообщил: вертикальные стрелки прокручивают
список, горизонтальные ничего не делают; из настроек Escape не возвращает
каталог. Инструкция агента была неоднозначна: проверка возврата в каталог
предполагалась после закрытия настроек, не одним Escape из них.
Выбранный альбом/keyboard target при проверке стрелок не уточнялись.
Пользователь явно не считает эти наблюдения проблемами текущей приёмки:
hotkeys отложены, Tab-навигацию планирует убирать. Полный keyboard/focus
пункт согласованно переносится, а не закрывается косвенным PASS.
Новую реализацию hotkeys или изменение Tab в этом сеансе не выполнять.

Блок 6 — PASS по подтверждению оператора «все ок»: при паузе выключен
сбор без очистки, существующие 19 альбомов и статистика остались доступны.
Около 30 секунд playback с выключенным сбором не добавились; после
повторного включения следующие около 30 секунд добавились без disabled
периода. Точные суммы/секундомер не снимались; это ручная проверка
enable/disable и сохранности истории, не новый ingest measurement.

Блок 7 — PASS по подтверждению оператора «всё ок»: полный выход из
приложения (включая tray), повторный запуск, сохранность истории/статистики,
обложек и названий, включённого сбора; playback и запись после запуска
работают. Точные суммы не снимались, восстановление выбранной карточки
после выхода не требовалось.

### Feather: идентичность установленного артефакта

Сбор выполнен read-only непосредственно на `FEATHER` после разрешения
оператора. Путь взят из `Get-Process` работающего Harbor Player, не из
локального `win-unpacked`: `%LOCALAPPDATA%\Programs\harbor-player\Harbor Player.exe`;
архив — `resources\app.asar` рядом с executable. Абсолютный путь с именем
пользователя в отчёт не переносится.

`Get-FileHash -Algorithm SHA256` — exit 0, hashes в таблице выше.
EXE **246401024 байт**, app.asar **75673428 байт**.
EXE FileVersion — `0.4.0-beta.2`, ProductVersion — `0.4.0.0`.
Node read-only parser заголовка ASAR прочитал `package.json` и
`dist/desktop/main.js`: version `0.4.0-beta.2`, buildCommit `4058653`.
Архив не распаковывался на диск и не менялся.

`Get-CimInstance Win32_OperatingSystem` подтвердил Windows 11 Pro x64,
version `10.0.26200`; registry DisplayVersion `25H2`, UBR `9711`.
Registry ProductName возвращает устаревшее `Windows 10 Pro` — для названия
использован OS Caption, не эта строка. Runtime Electron/Chromium versions,
CSS viewport и zoom автоматически не снимались. Настройки, библиотека,
профиль, процессы приложения и power settings при сборе не менялись.

### Feather: installed error/fallback — PASS

По запросу оператора добавлен `scripts/pulse-installed-errors-check.mjs`.
На Feather установлены dev dependencies командой `npm ci --ignore-scripts`
(exit 0; npm сообщил 17 dependency vulnerabilities, автоматический audit fix
не выполнялся). Установленное приложение не пересобиралось/переустанавливалось.

Команда PowerShell: получить единственный EXE path из работающего
`Get-Process`, установить `HARBOR_PLAYER_DESKTOP_EXECUTABLE`, затем
`node scripts/pulse-installed-errors-check.mjs`.
Финальный форматированный script — exit 0, evidence
`.test-data/pulse-installed-errors-ActtWT/result.json` и screenshots рядом.
Предыдущий успешный run — `.test-data/pulse-installed-errors-g1wEX2`.
Локальные raw evidence и абсолютные пути не публиковались.

Harness запускает именно установленный executable (оба SHA-256 совпали
с таблицей), с отдельным data dir/profile и случайными API/CDP ports.
Benchmark flag отключает updater/tray в тестовом процессе. Временная
история — три синтетических события по 60000 мс, не actual playback.
API/image ответы подменяются только через route тестового renderer:

- history-range HTTP 503 → видимый alert; снятие route и настоящий click
  «Повторить» → статистика доступна, alert исчез;
- cover HTTP 404 → broken image скрыт, название/исполнитель/статистика остаются;
- HTTP 200 с одним PNG signature без изображения → тот же fallback;
- выбор следующего альбома с валидным PNG → selected image visible,
  naturalWidth 1; ошибка предыдущей обложки не сохраняется.

Для всех трёх альбомов UI показывает 1 мин / 1 день / 0 возвратов.
Агент просмотрел screenshots corrupt/recovered, title и stats читаемы.
Renderer userAgent подтвердил Electron `44.4.1` / Chrome `152.0.7977.78`;
при старте тестового окна CSS viewport `1426×883`, DPR `1.25`
(это не размеры окна оператора во всех ручных блоках).
Обычный процесс пользователя не останавливался; завершалось только
дерево PID созданного harness disposable instance. История 19 альбомов,
профиль и музыка оператора не изменялись.

Неполные попытки сохранены: `pOx5W9`/`lHAL5W` — harness ожидал exact
accessible name без исполнителя/длительности, хотя реальная aria-label
их включает; `v0l0N6` — сравнивал innerText с textContent (переносы строк).
Исправлены только selectors/согласованный способ чтения текста; timeout
и продуктовый код не менялись. API error/retry прошёл и в этих попытках.
Это installed UI fallback проверка, не fault injection реального API
процесса, не physical file-corruption/recovery и не замена ручным блокам.
