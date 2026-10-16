# Пульс: разрешённые обложки и actual storage

Измерения этапа 1 из [инструкции](../../pulse-next-steps.md).
Это отдельные short actual playback и image diagnostics, не год наблюдений
и не повтор полного native-memory cohort.

## Разрешение и входные данные

Пользователь разрешил копировать обложки действующей основной медиатеки
для отдельных локальных тестов и короткий foreground-сеанс Electron.
Взяты побайтовые копии из действующего кэша обложек приложения.
Рабочая БД, исходные аудиофайлы, обложки и `server.lock` не изменялись.
Установка, интеграция, push и публикация не выполнялись.

Локальный fixture: `.test-data/pulse-permitted-originals/manifest.json`.
Используется существующий формат `version: 1, permitted: true, files`:
относительные имена, без второго формата manifest.
`selection.json` рядом содержит локальные SHA-256 и provenance копий.
Изображения, приватные пути и traces не включаются в Git.

| Формат | Размер, пиксели | Байты |
| --- | ---: | ---: |
| JPEG | 160×160 | 6 841 |
| PNG | 2397×2397 | 8 931 138 |
| JPEG | 160×160 | 8 574 |
| JPEG | 3680×3680 | 1 842 204 |
| JPEG | 323×500 | 47 798 |
| JPEG | 250×122 | 12 786 |
| PNG | 1600×1600 | 51 062 |
| **Всего** | **7 файлов** | **10 900 403** |

Выборка включает минимальный/максимальный вес, площадь, пропорции
и крайние веса PNG в доступном кэше из 562 JPEG/PNG.
Копирование не перекодирует изображения. Это originals из используемого
кэша, а не доказательство идентичности embedded artwork исходного аудио.
Preflight `inspectPermittedArtwork` проверяет существующий manifest и budgets;
лимиты по умолчанию 16 MiB/file, 128 MiB/manifest не повышались.

## Actual playback

**PASS**: два независимых прогона по 4 и 3 originals, каждый в Chrome и Edge.
База `2742aed819191159a1cd26182fee2c857f1e36b8`, dirty harness/docs,
Windows 10.0.22621 x64, Node v24.20.0,
Intel i7-11700F, 68 548 898 816 bytes RAM.
Chrome 155.0.8059.84, Edge 155.0.4283.45.

```sh
HARBOR_PLAYER_UI_ARTWORK_MANIFEST=.test-data/pulse-permitted-originals/manifest-storage-a.json npm run test:pulse:process
HARBOR_PLAYER_UI_ARTWORK_MANIFEST=.test-data/pulse-permitted-originals/manifest-storage-b.json npm run test:pulse:process
```

Обе команды exit 0. Это тот же version-1 manifest, разделённый без перекодирования.
Raw evidence: `.test-data/pulse-process-gkeMXQ/` (A),
`.test-data/pulse-process-LNLHBl/` (B); логи команд в
`.test-data/pulse-permitted-originals/process-a.log` и `process-b.log`.
В каждом browser dir: `provenance.json`/`result.json`, `storage.json`,
`outage.json`, `outbox.json`, `http-storage-before-restart.json`,
`http-storage-after-restart.json`, `server.log`.
Полные source/dist SHA-256 и executable identity сохранены в raw evidence.
Node executable SHA-256:
`5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5`.
Измеренный process-harness SHA-256:
`f2090043291ec82d203ff1d4f16232cb61ac35e1387c58706fe82480ccca9d21`
(последующее форматирование не меняет поведение).

Оригиналы встроены точными APIC bytes в generated WAV с уникальными album/title.
Дальше настоящий scan → audio → recorder → IndexedDB outbox → HTTP → SQLite.
Synthetic listening seeds и записи track/event напрямую в БД не используются.
Все originals кроме последнего в группе публикуются на checkpoint,
затем используют existing archive на final/retry. Последний original временно
убран из scanned cache: checkpoint сохраняет title/statistics, cover HTTP — 404.
После остановки API источник возвращается, durable final восстанавливает архив
после server/browser restart. Все семь final-архивов проверены по SHA-256.
Это не матрица «каждый original в каждом состоянии».

| Группа / browser | Checkpoint сумма, мс | Final = duplicate finals = stale checkpoint, мс | Intervals / albums / day-albums / visits |
| --- | ---: | ---: | --- |
| A / Chrome | 60 378 | 128 864 | 4 / 4 / 4 / 4 |
| A / Edge | 60 381 | 131 989 | 4 / 4 / 4 / 4 |
| B / Chrome | 45 090 | 100 378 | 3 / 3 / 3 / 3 |
| B / Edge | 45 247 | 91 862 | 3 / 3 / 3 / 3 |

Для каждой фазы exact ledger contributions сверены с каждым day/album ключом,
суммами `pulse_days`, `pulse_day_albums`, `pulse_album_stats`; везде один day.
Offline checkpoint/final остаются в outbox и не увеличивают принятую сумму
до восстановления API. На retry ни cardinality, ни суммы не выросли.

| Группа (оба browser) | WAL baseline / checkpoint / final+retry, bytes | Covers checkpoint → final, count / bytes |
| --- | --- | --- |
| A | 791 072 / 873 472 / 931 152 | 3 / 8 946 553 → 4 / 10 788 757 |
| B | 733 392 / 815 792 / 869 352 | 2 / 60 584 → 3 / 111 646 |

SQLite file во всех sequential samples — 4096 bytes, SHM — 32 768.
Logical `dbstat` allocation — 278 528 bytes, из них **159 744 index bytes**
(имена сопоставлены с `sqlite_schema type=index`), на baseline/final без роста.
WAL содержит ещё не checkpointed pages: 4096 не означает «вся БД весит 4 KiB».
Quiescent staging до/после — **0** во всех snapshots. В sampling наблюдалось
не более одного staging entry и 0 sampled image bytes; краткие копии могли
попасть между samples, это не доказательство отсутствия временного I/O.
Harness ограничивает samples четырьмя active copies и input-byte budget.

| Группа / browser | Overlapping catalog reads до restart, n / p95 мс | После restart, n / p95 мс |
| --- | --- | --- |
| A / Chrome | 1 / 5,372 | 3 / 4,073 |
| A / Edge | 1 / 3,860 | 4 / 6,069 |
| B / Chrome | 0 / NOT MEASURED | 3 / 12,523 |
| B / Edge | 0 / NOT MEASURED | 1 / 4,162 |

Это concurrent `/api/libraries` reads с наблюдённым пересечением реальных
ingest HTTP intervals. Наблюдённые p95 < 50 мс, но 1–4 samples не дают
стабильной tail-оценки. Нет overlap — NOT MEASURED, не PASS.
Ingest ACK не сравнивался с UI/read порогом.

### Missing/corrupt в настоящем Pulse UI

```sh
node scripts/pulse-process-cover-ui.mjs --data-dir .test-data/pulse-process-gkeMXQ/chrome/data --channel chrome
node scripts/pulse-process-cover-ui.mjs --data-dir .test-data/pulse-process-gkeMXQ/msedge/data --channel msedge
```

Обе команды exit 0, PASS. Использованы **копии** actual ledger, не synthetic seed.
Raw evidence окончательного checker:
`.test-data/pulse-process-cover-ui-8mxtVo/` (Chrome),
`.test-data/pulse-process-cover-ui-f9nQui/` (Edge).
На `Original 0001` проверены normal, отсутствие archive+cache, corrupt same-ID
bytes. При missing/corrupt image naturalWidth=0 и visibility=hidden, но точное
название, три statistics values, day duration/share и API stats сохранены.
Source SQLite **и WAL**, а также logical Pulse state hashes не изменились;
до старта копии совпали с source. На время проверки read-only ownership lock
исключает запуск сервера с source data dir, live owner отвергается.
Accepted playback artifacts не повреждались.
Это один representative album в каждом browser, не все возможные decode errors.
HTTP отдельно подтвердил 200 / 6841 bytes / exact original hash в normal,
404 / empty body в missing, 200 / 33 invalid bytes в corrupt.
Ранние проверки до добавления HTTP status/hash assertions тоже прошли:
`pulse-process-cover-ui-0TVDFZ` и `pulse-process-cover-ui-swkCLU`;
основной результат выше относится к усиленному скрипту.
Промежуточные `pulse-process-cover-ui-TU1VTg` / `pulse-process-cover-ui-3BxD1o`
прошли с HTTP assertions, но до final-review исправления source snapshot.
Checker теперь выбирает последнюю **populated** дату из копии ledger,
а не `range.lastDay` (диапазон продлевается до today). Regression tests
проверяют historical offset, отказ live owner, точность SQLite/WAL/logical copy,
удержание source lock и обнаружение изменения WAL/state.

### Сохранённые неудачные попытки

Первые попытки с семью одновременными окнами остановились **до playback**:
`.test-data/pulse-process-BxsyQP/`, `pulse-process-Gi35Oi/`,
`pulse-process-KEiJLb/`. В последней сохранены failure HTML и server log.
Шесть постоянных `/api/events` заняли HTTP/1 browser connection pool,
после чего catalogue оставался busy. Увеличение timeout не применялось:
добавлен ранний preflight максимум четырёх входных файлов, выборка разделена.
Две промежуточные попытки улучшить ожидание UI не устранили connection limit;
они не объявлены успешными. Это новый harness setup failure,
не воспроизведение и не исправление исторического recorder timeout.

## Image / native / GPU diagnostic

```sh
node scripts/pulse-artwork-diagnostic.mjs --foreground --manifest .test-data/pulse-permitted-originals/manifest.json
```

Exit 0, **COMPLETED**: transfer, decode, native, allocator и Windows GPU
компоненты MEASURED. Raw evidence:
`.test-data/pulse-p1-ui-artwork-yPvBlM/evidence.json` и три private memory traces.
Тот же source SHA/dirty, Electron 44.4.1 / Chromium 152.0.7977.78.
Запущен установленный Electron runtime против workspace app, **не installer
и не packaged app acceptance**. Runtime executable SHA-256:
`4e069955705384d0b711bedf5611b7c0bc91ff8c84fc199879d29fc4910f9bab`;
workspace desktop main:
`9100b5af2d495d01c6312e2de2432e4b2a7e317d8deb9f7055c75c64dd644aa1`;
manifest:
`3f6d7604f511f5132be406e8d15b1d2cfba2e9680b2dac6a4eb89bafc91fe261`.
Полные harness/dist hashes сохранены в evidence.
GPU NVIDIA GeForce RTX 4070 Ti, driver 32.0.16.1088,
ANGLE D3D11 / Skia GaneshGL.

Это **отдельный aggregate UI fixture с диагностическим overlay**, не actual
recorder evidence и не latency настоящих Pulse cards.
Все HTTP body проверены по длине, MIME и SHA-256 original.
Transfer (до полного body) отделён от `img.decode()` blob URL:

| Original | HTTP fetch total, мс | Body collection после headers, мс | Browser decode, мс |
| --- | ---: | ---: | ---: |
| JPEG 160×160 / 6841 B | 3,6 | 0,5 | 0,8 |
| PNG 2397×2397 / 8931138 B | 31,6 | 29,3 | 63,8 |
| JPEG 160×160 / 8574 B | 3,8 | 0,7 | 0,8 |
| JPEG 3680×3680 / 1842204 B | 6,3 | 4,3 | 108,9 |
| JPEG 323×500 | 4,6 | 0,4 | 1,7 |
| JPEG 250×122 | 3,0 | 0,4 | 0,8 |
| PNG 1600×1600 | 2,3 | 0,4 | 6,5 |

По одному sample на original, не acceptance p95. Fetch timings включают
локальный HTTP/browser overhead, не чистую пропускную способность сети.
Blob SHA-256 выполняется после transfer и до decode, не внутри этих интервалов.
Decoded означает decode + две rendering opportunities, не hardware paint.

| Native metric, KiB | Before | Decoded/displayed | После удаления overlay + 10 с idle |
| --- | ---: | ---: | ---: |
| Renderer working set | 117 272 | 221 132 | 180 828 |
| Renderer private bytes | 44 852 | 67 616 | 59 332 |
| GPU-process working set | 113 784 | 214 564 | 159 928 |
| GPU-process private bytes | 148 040 | 419 236 | 307 844 |

Все `app.getAppMetrics` process rows сохранены, таблица показывает renderer/GPU,
а не суммарную память приложения. Working set/private bytes не равны VRAM.

| Windows GPUProcessMemory, bytes (один owned GPU PID/adapter) | Before | Decoded | Idle |
| --- | ---: | ---: | ---: |
| DedicatedUsage | 114 642 944 | 253 964 288 | 197 140 480 |
| SharedUsage | 19 247 104 | 59 887 616 | 43 200 512 |
| TotalCommitted | 134 733 824 | 375 611 392 | 241 074 176 |

Это OS process/adapter counters, не чистая память только обложек.
Dedicated/shared/committed не суммируются как независимые расходы.

| Chromium allocator `size`, bytes | Before | Decoded | Idle |
| --- | ---: | ---: | ---: |
| Renderer `cc/image_memory` | 9 519 104 | 63 426 788 | 63 426 788 |
| GPU `skia/gpu_resources` | 45 718 808 | 120 072 259 | 84 584 515 |
| GPU `gpu/shared_images` | 39 391 808 | 39 801 408 | 27 382 336 |

Три detailed dumps: success=true, dataLossOccurred=false.
Сохранены оригинальные allocator names, hex/decimal scalar values и units.
Byte-valued size counters отделены от object counts; overlapping allocator
деревья **не суммируются**. JS heap не использован как native/GPU proxy.
Снимки native, OS GPU и Chromium sequential, не атомарные и не peaks.
Tracing/inspector overhead входит в cohort; forced GC не вызывался.
За 10 секунд idle кеши не обязаны опустеть: это не leak verdict.

Первая попытка `.test-data/pulse-p1-ui-artwork-vLRa4O/` — FAIL до snapshots
из-за `ELECTRON_RUN_AS_NODE` в окружении; переменная теперь удаляется из env.
Промежуточный `.test-data/pulse-p1-ui-artwork-Si5LLK/` COMPLETED, но до
усиления response hash/MIME и component status проверок; таблицы взяты
из последнего `yPvBlM`, не из промежуточного результата.
Foreground подтверждён для трёх samples; параллельные build/e2e/benchmarks
во время согласованных измерений не запускались.

## Существующие 30/365-дневные модели

Ниже старые ускоренные generated-model результаты, не новые прогоны
и не измерения permitted originals. Сохранённые raw artifacts прочитаны
для сопоставления; workload, artifact и число сценариев различаются.
Суммы включают дополнительные correctness/benchmark-сценарии,
поэтому не обязаны равняться только `days × 2 hours`.

| Поле | 30-day generated | 365-day generated |
| --- | ---: | ---: |
| Raw evidence | `.test-data/pulse-p1-ingest-ZOOwoi/result.json` | `.test-data/pulse-p1-ingest-Lwz1VM/result.json` |
| Исходный SHA | `88f9f055d93179ec2eea6250ba31697b64120c40` | `14b705bd2634f55b5f0e0e0465f9a5195727546e` |
| Точная сумма ledger / day / day-album / album, мс | 260 386 000 | 2 667 886 000 |
| Intervals / albums / days / day-albums | 2292 / 1583 / 31 / 1931 | 12042 / 3293 / 366 / 7661 |
| SQLite bytes после model checkpoint | 3 522 560 | 12 640 256 |
| Все индексы `dbstat`, bytes | 1 331 200 | 4 370 432 |
| Archived covers count / bytes | 855 / 8 790 222 | 2565 / 26 360 745 |
| Final staging entries | 0 | 0 |
| Максимальный наблюдённый WAL sample, bytes | 4 396 072 | 4 614 432 |
| Overlapping catalog read p95, мс | 30,672 | 33,052 |
| Overlapping reads, n | 1797 | 1552 |

Модели используют generated square PNG и synthetic events.
Короткий actual playback проверяет реальные recorder revisions и delivery;
он не измеряет годовой рост. Размер файла SQLite до checkpoint нельзя
сравнивать с model post-checkpoint без WAL и logical page/index accounting.
В actual-прогоне forced SQLite checkpoint не нужен.
WAL/SHM — последовательные samples, не физический peak.
Ориентир catalog read p95 < 50 мс не применяется к ingest ACK.

## Проверки и границы

`npm run build` — PASS, в том числе внутри обеих process-команд;
Финальный `npm test` — **63 файла / 478 тестов PASS**, включая три Node allocator tests
через Vitest bridge. `npm run lint` — PASS.
Проверялись dirty-изменения поверх указанного `2742aed`.
Первый `format:check` обнаружил неотформатированный новый UI diagnostic:
это не runtime failure; после форматирования точные `npm run format:check`,
`npm run lint`, `git diff --check` — **PASS**.
Финальный лог `npm test`: `.test-data/pulse-permitted-originals/tests-final.log`
(ранний PASS 62/476 — `tests.log` рядом).
Повтор default `npm run test:pulse:process` **без manifest** — exit 0,
Chrome/Edge PASS: `.test-data/pulse-process-yfcLIj/`, суммы
61 486 / 61 223 мс, по два intervals/tracks/sessions/visits;
лог `.test-data/pulse-permitted-originals/process-default.log`.

Production pipeline/UI/recorder не менялись: добавлены harnesses/evidence/tests.
Thumbnail или переработка pipeline не выполнялись: один большой decode
108,9 мс и before/after memory не устанавливают product bottleneck.
Полный 30-минутный memory cohort, installed/manual, physical input/FAT/exFAT,
sleep, publication crash и полный e2e здесь **не повторялись**;
этапы 2–4 и финальный integration/CI gate остаются отдельными.
