# Пульс P1: ownership, staging recovery и недостающие UI-регрессии

Продолжение [четвёртого этапа](pulse-p1-stage4.md) по историческому
плану закрытия релиза. Текущий статус — в [roadmap](../../pulse-roadmap.md).
База — `00f9342f98086f553a0b6bbf21371da848f9d106`,
`wip/pulse-p1-followup`; проверяются dirty-изменения поверх неё.
Windows 10.0.22621, Node v24.20.0, Electron 44.4.1.
Merge/push/установка/релиз не выполнялись. Рабочая пользовательская БД
не использовалась для seed, очистки, crash или нагрузки.

## R1: исключительное владение data dir

`src/server/instance-lock.ts` больше не использует read-PID → unlink takeover.
Отдельная постоянная `server-ownership.sqlite` держит `BEGIN EXCLUSIVE`
в rollback-journal режиме до закрытия сервиса или смерти процесса.
Используется уже имеющийся `better-sqlite3`, без новой native-зависимости.

До исправления детерминированный multi-process regression воспроизвёл гонку:
второй претендент удалял новую блокировку победителя и тоже становился владельцем.
После исправления 14 ownership tests проверяют конкурентные старты, живого
владельца, настоящий kill/restart, crash до/во время создания marker,
same-process double acquire и repeated/late release.

**Операционная граница:** `server.lock` теперь постоянный точный protocol marker,
который старые бинарники отвергают. Старые PID/неполные/неизвестные файлы
не мигрируются автоматически, даже если PID кажется мёртвым.
[Протокол и offline migration](../../data-dir-ownership.md).
Рабочая блокировка пользователя не удалялась и не мигрировалась.
Пользовательский dev watcher действительно встретил этот fail-closed отказ;
ожидание окончания тестов само по себе не мигрирует старый marker.

SQLite должен иметь надёжные filesystem locks, как и основной каталог.
Windows execution не выдаётся за POSIX/network/physical FAT/exFAT validation.
Реальный permission-denied ownership DB не проверен отдельно; corruption
и некорректные/недоступные markers покрыты тестами.

## R2: owned-staging recovery и startup/shutdown

`src/server/pulse-staging-recovery.ts` работает в начале `MusicService.initialize`,
под уже захваченным lifetime ownership, до API и новых copy:

- точный producer namespace cover ID + UUIDv4, не broad glob;
- только пустая директория либо единственный обычный singly-linked `image`;
- `lstat` для root/staging/image, без recursive delete и traversal;
- foreign/ambiguous, links/junctions, hardlinks, flat/archive сохраняются;
- transient sharing errors: ограниченные retries 20/40/80 мс;
- persistent errors отклоняют startup, неоднозначность пишет диагностику.

`initialize()` кеширует весь promise сразу, поэтому повторный вызов не запускает
cleanup живых копий и не создаёт второй timer. `close()` ждёт initialization,
удерживая ownership; повторно очищает timer после окончания startup.
`createApp` освобождает частично построенное приложение и сервис при любой
ошибке конфигурации, включая initialize и boot плагина. Ревью выявило этот
путь утечки; добавлены отдельные failure/retry/shutdown регрессии.

`npm run test:pulse:publication` — **PASS**:
`.test-data/pulse-publication-crash-aATf5L/evidence.json`.
Три цикла в одном data dir: настоящая chunked copy, fsync **65 536** из
**1 048 576 bytes**, точный exit `{ code: null, signal: "SIGKILL" }`,
restart через `MusicService`, удаление owned orphan и реальный retry.
Результат termination записан отдельно для каждого цикла.
Нет ACK/публикации до kill и listening commit до retry. Каждый архив совпал
с source SHA-256, каждая повторная доставка сохранила ровно **15 000 мс**;
day totals нарастают точно. Foreign/published/ambiguous/junction canaries
сохранились; собственные orphan не накапливаются.

Это production publication/transaction code с управляемым paused copy adapter,
не случайный kill внутри штатного `copyFile` и не проверка image decode.
Враждебная внешняя подмена файлов между path-based проверками не входит
в гарантию; другой Harbor исключён ownership. Physical FAT/exFAT — NOT RUN.
Оставшийся прежний constructor-reconciliation failure cleanup — follow-up:
ошибки jobs/history после создания workers не входят в новую async startup
приёмку; безопасное освобождение требует отдельного lifecycle regression.

## R3: UI и диагностические профили

В `tests/browser/pulse.spec.ts` добавлены:

- wheel на обеих границах и обратное движение;
- Ctrl+wheel не отменяется и не прокручивает timeline;
- задержанные ответы предыдущей даты не возвращают дату/scroll;
- длинные title/artist в light/dark с custom accent на пяти ширинах.

Новая long-artist проверка сначала падала в Chrome и Edge на 390×480:
title был ограничен, artist — нет. Минимальный CSS fix добавляет перенос
и двухстрочный clamp только artist paragraph.
Targeted Chrome/Edge: **8/8 PASS**, включая прежнюю viewport geometry.
Synthetic Ctrl+wheel не доказывает настоящий browser zoom или physical input.

В `scripts/pulse-ui-benchmark.mjs` добавлены user-timing marks и renderer-clock
окна year-jump/wheel/drag с before/after date/scroll и overlapping long tasks.
Время окна включает automation/readiness overhead; это не input-to-paint latency.
Marks сразу удаляются из User Timing buffer, чтобы не накапливать их в длинном
cohort. Отдельная реальная CDP-проверка Edge подтвердила сохранение обоих marks
в trace при нулевом числе retained marks:
`.test-data/pulse-p1-stage5-final/trace-marks.json`.

Две точные диагностические команды:

```sh
npm run test:pulse:ui -- --smoke --diagnostic --diagnostic-runs=5 --channel=msedge --cold=startup-overlap
npm run test:pulse:ui -- --smoke --diagnostic --diagnostic-runs=5 --channel=msedge --cold=ready-panels
```

Evidence: `.test-data/pulse-p1-ui-D73MsH/summary.json` и
`.test-data/pulse-p1-ui-960xLc/summary.json`; traces в dataset-подкаталогах.
Это более ранний dirty snapshot: ownership/recovery ещё не были объединены;
не новый финальный latency gate для текущего packaged artifact.

| Edge diagnostic, 5 cold/dataset | ordinary dataReady max, мс | ten-year dataReady max, мс |
| ------------------------------- | -------------------------- | -------------------------- |
| startup-overlap                 | 178,1                      | 195,2                      |
| ready-panels                    | 125,6                      | 131,7                      |

В startup-overlap shell DOM наблюдался за 6,2–8,1 мс; в девяти из десяти
samples был RAF wait 142,9–156,5 мс. В ready-panels максимальный RAF wait
не превышал 26 мс. Нет overlapping renderer long tasks >50 мс и
зарегистрированных visibility/focus transitions. Исторический хвост >400 мс
не воспроизведён: **причина остаётся INCONCLUSIVE**, а не «исправлена».
Эти 5 samples и тяжёлые traces не заменяют acceptance cohort.

Короткие navigation traces обеих серий завершены без long tasks >50 мс.
В ten-year действительно менялись scroll/date при year-jump/wheel/drag;
ordinary в этом viewport целиком помещается, жесты не доказывают scrolling.
Это краткий профиль, не повтор длительного stress/native-memory cohort.

## Packaged crash/restart и ingest после изменений

`npm run test:pulse:desktop` — **PASS**:
`.test-data/pulse-desktop-tNU1uE/evidence.json`.
Checkpoint **15 028 мс** восстановлен точно, наблюдаемый хвост **4135,541 мс**.
Durable pending **30 031 мс**, после paused restart сумма **45 059 мс**,
replay counted once. Два действительно проигрывающих окна: два events/sessions,
точная сумма **82 794 мс**.

Дополнительная идентичность после прогона:
`.test-data/pulse-p1-stage5-final/artifact-identity.json`.
На момент фиксации hashes desktop pack ещё не повторялся;
embedded app/service/lock/recovery и desktop main совпали с compiled files.
Это сборка до исправления dependency resolution; последняя сборка указана ниже.

- executable SHA-256:
  `b9dfa609f02805ebc3165282c9a5019fae775378485c43f73b3c7fce12944fca`;
- app.asar SHA-256:
  `3aa451410732d6558f834ff74b6783caa241bb95b256f9cbffb3ac2d6d4f66fa`.

`npm run benchmark:pulse:ingest` — **PASS**:
`.test-data/pulse-p1-ingest-hM9Arg/result.json`.
Четыре суммы **260 386 000 мс**, **855 images / 8 790 222 bytes**,
индивидуальная integrity проверена, staging **0**.
Overlapping catalog read p95 **35,7885 мс** на 2708 запросах;
baseline **30,3119 мс**. Sampled WAL peak **4 367 232 bytes**.
Это generated 30-дневная модель, не actual recorder с originals
и не год наблюдений. Конкурентная нагрузка машины не контролировалась;
числа не являются новой изолированной target-device гарантией.

## Общие проверки и открытые результаты

Логи: `.test-data/pulse-p1-stage5-final/`.

| Команда                          | Результат                                                        |
| -------------------------------- | ---------------------------------------------------------------- |
| `npm test`                       | PASS: 56 файлов, 453 теста                                       |
| `npm run build`                  | PASS, включая typecheck; прежний chunk warning не скрывался      |
| `npm run lint`                   | PASS                                                             |
| `npm run format:check`           | PASS; ownership doc отдельно проверен Prettier                   |
| `npm run test:pulse:publication` | PASS: три точных SIGKILL/restart/retry цикла                     |
| `npm run test:pulse:desktop`     | PASS на свежем packaged artifact                                 |
| `npm run benchmark:pulse:ingest` | PASS, с ограничениями выше                                       |
| `git diff --check`               | PASS                                                             |
| `npm run test:e2e`               | PASS: полный Chrome 144/144 + Edge 144/144 после dependency fix  |
| `npm run test:pulse:process`     | PASS повторного прогона Chrome/Edge; прежний timeout не объяснён |

Первый общий e2e упёрся в wall-time limit инструмента 600 секунд:
Chrome **144/144**, Edge не закончен; выведенный прерванный media-error сценарий
не объявляется установленной регрессией. Второй общий запуск прерван пользователем
после Chrome **144/144** и части Edge. Test timeout/retries/skip не менялись.
Затем полный прогон был передан отдельному reviewer; его попытки и итог
описаны ниже. Принятый 141+141 в четвёртом этапе относится только к старым
исходникам, а не автоматически к новым изменениям.
Первая попытка reviewer завершилась до запуска тестов: изолированная копия
не содержала generated `.fixtures/cover.png`. Этот setup FAIL сохранён в
`.test-data/independent-e2e-20261016T130715Z-1338/npm-run-test-e2e.log`.
После точного `npm run fixtures` разрешён один новый полный
`npm run test:e2e`; production/test timeout и ожидания не менялись.

Этот новый прогон завершился **exit 1**, Chrome **143/144**, Edge **NOT RUN**
(команды соединены `&&`). `tests/browser/library.spec.ts:2905` ожидал enabled
«Применить к 1 файлам»; preview вернул HTTP 200, но FLAC item был skipped:
«Запись FLAC не прошла проверку безопасности и отключена».
Evidence reviewer:
`.test-data/independent-e2e-with-fixtures-20261016T131019Z-496/`,
включая `failure-artifacts/failing-preview-network.txt` и trace.
Это не Pulse assertion и не доказательство исправления/ухудшения FLAC writer.
До повторного запуска проверяется обязательный README/CI prerequisite
`npm run verify:tags`: его нельзя заменить разрешением записи в тесте.
В parent tracked report writerVersion=installed=1.0.4, FLAC passed=true;
причина расхождения изолированного reviewer установлена ниже.

### Исправление dependency resolution, без ослабления FLAC gate

Точный `npm run verify:tags` в reviewer напечатал PASS для всех семи форматов,
включая FLAC, но затем завершился exit 1: скрипт искал `package.json`
только в локальном `node_modules`, которого в isolated worktree нет.
Реальная зависимость версии 1.0.4 разрешалась Node из родительского каталога.
`MusicService.initialize` использовал такой же hardcoded путь и оставлял
`writableFormats=[]`, `verificationDate=null` при ENOENT. Это подтверждено
`/api/session` из сохранённого trace.
Evidence: `.test-data/tag-verify-gated-e2e-20261016T132205Z-1300/`.

Теперь `src/server/tag-writer-version.ts` определяет версию через
`createRequire(import.meta.url).resolve`, по настоящим правилам загрузки Node.
Один helper используется сервисом и `scripts/verify-tags.mjs`; сам writer
в основном процессе не загружается. Отчёт всё ещё должен совпадать по версии,
а разрешаются только форматы с passed=true. Unknown/mismatch/read failure
по-прежнему оставляют запись отключённой.

Добавлено пять регрессий: dependency в ancestor при отсутствии local
node_modules, package metadata без version, report match/mismatch/read failure.
После исправления parent повторил точные команды:
`npm test`, `npm run build`, `npm run lint`, `npm run format:check`,
`npm run test:pulse:publication`, `npm run test:pulse:process`,
`npm run test:pulse:desktop`, `git diff --check` — **все PASS**.
Последний unit suite: **56 файлов / 453 теста**.
Лог: `.test-data/pulse-p1-stage5-final/checks-dependency-fix.log`.

- Publication: `.test-data/pulse-publication-crash-hM99NM/`,
  три точных SIGKILL/restart/retry цикла.
- Process: `.test-data/pulse-process-TVrFNx/`,
  Chrome/Edge четыре суммы **61 741 / 61 708 мс**, по два intervals.
- Fresh packaged desktop: `.test-data/pulse-desktop-nI2EpJ/`,
  checkpoint **15 050 мс** восстановлен точно, tail **4239,942 мс**;
  pending **30 080 мс**, restored **45 130 мс**, replay once;
  два играющих сеанса, точная сумма **83 208 мс**.
- Идентичность новой сборки:
  `.test-data/pulse-p1-stage5-final/artifact-dependency-fix-identity.json`.
  Embedded service/helper/lock/recovery/app/main совпали с compiled files.
  Executable SHA-256:
  `ff4e573829feeea84a13baf835a5099d9eef7214bdd614ac5a63038bed250dc8`;
  app.asar SHA-256:
  `746e9dcc3538ad4cce1f5f521790ec61fffd2d2e2a2a4e06b764f06f30994439`.

Новый reviewer выполнил точные команды **по одному разу**:
`npm run fixtures` → `npm run verify:tags` → `npm run test:e2e`.
Все exit 0; все семь tag formats PASS; полный e2e **Chrome 144/144 (4,8 мин)
и Edge 144/144 (4,7 мин)**. Без фильтров, skip, retries или изменения timeout.
Это correctness validation, не performance acceptance.

Node v24.20.0, npm 11.19.0, Chrome 155.0.8059.84, Edge 155.0.4283.45.
Tracked report обновлён настоящим verify:tags: дата
`2026-10-16T13:26:59.371Z`, writerVersion=1.0.4, FLAC passed=true,
3 820 829 bytes. MP3 output size изменился с 3 809 266 до 28 529 bytes;
это результат свежей generated fixture, не изменение safety gate.
Report SHA-256:
`1ecfb2f2908c501388ba4af9068888e4fa5f4ed843e8ab745690996a9db0aca6`.
Source/report hashes до и после e2e совпали; единственный generated tracked
diff подготовки — date/MP3 bytes в `verification/tag-support.json`.
`test-results/.last-run.json` — `status=passed`, `failedTests=[]`,
SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.
Командный transcript и hashes сохранены в отчёте независимого reviewer
«Validate fixed dependency resolution gate» этой ветки обсуждения;
это изолированный прогон, не новый GitHub CI.
Прежние setup FAIL, Chrome 143/144 и прерванные попытки выше не переписываются.

Process failure: `.test-data/pulse-process-2vAATa`, Chrome;
`scripts/pulse-process-check.mjs:289` не дождался двух intervals.
В сохранённой БД enabled=1, timezone UTC, generation=2, intervals пуст.
Не повышать timeout и не выдавать desktop PASS за browser process PASS.
Задача диагностики перезапущена после сброса лимита модели.

После возобновления worker выполнил точный `npm run test:pulse:process` успешно
без изменений; stale build не подтверждён: все 145 source hashes и 148 dist
hashes исходного отказа совпадали с актуальными файлами до новой диагностики.
Нет доказательства settings race или production defect.

Изменён только `scripts/pulse-process-check.mjs`: при новом checkpoint failure
до teardown сохраняются обе media states/buffers/errors, media/Pulse/error
timelines, IndexedDB pending, SQLite settings/intervals и per-page
settings/listening HTTP requests/responses/failures. Timeout и все прежние
playback/checkpoint/outage/restore/sum/retry assertions сохранены.
Этот failure-capture путь не был исполнен настоящим новым отказом.

Финальный точный `npm run test:pulse:process` в изолированном worker — **PASS**:
`.test-data/pulse-process-BYa1eK/`, Node v24.20.0, та же база dirty.
Chrome 155.0.8059.84: два intervals, четыре суммы **61 909 мс**,
outage **15 201 мс**. Edge 155.0.4283.45: два intervals,
четыре суммы **61 616 мс**, outage **15 146 мс**.
Harness SHA-256:
`7e88f0eb2b46a12d88a6f5f1830f4aa723bf3c8d6d4319d02ee87a99f221ac21`.
Реальные buffered WAV windows, API outage/restart/profile restoration,
duplicate-final/stale-checkpoint checks не подменялись mocks.
Успешные повторы не разрешают объявить исходный timeout исправленным.
После объединения diagnostics-only harness изменений parent повторил
`npm test`, `npm run build`, `npm run lint`, `npm run format:check`,
`git diff --check`: **PASS**, по-прежнему 54 файла / 448 тестов.
Лог: `.test-data/pulse-p1-stage5-final/checks-last.log`.

Открыты: причина исходного process timeout, permitted originals/actual
artwork storage, installed/manual и physical input/FAT, причина исторического
Edge startup хвоста, окончательный CI и согласованная интеграция.
P1 и release gate **не закрыты**.
