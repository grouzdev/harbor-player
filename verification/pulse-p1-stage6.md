# Пульс P1: шестой этап — реализация и оставшаяся приёмка

План: [автономный шестой этап](../docs/pulse-autonomous-stage6-plan.md).
Исходная база `8662de6`; диагностическая часть A уже попала в отдельный
`88f9f055d93179ec2eea6250ba31697b64120c40`.
Остальные изменения проверялись как dirty поверх `88f9f05`.
Windows, Node v24.20.0. Рабочая пользовательская БД и server.lock не менялись.
Push, установка, интеграция с main и релиз не выполнялись.

## A. Отказоустойчивая диагностика

Checkpoint failure-capture имеет отдельный общий бюджет 3000 мс.
Media/IndexedDB/SQLite/response probes собираются независимо, с явными
ok/error/timeout; сохраняются original error/cause и стабильные window IDs.
Синхронное SQLite чтение вынесено в отменяемые workers.
При отмене worker получает terminate, unref и обработчик rejection:
неподтверждённая остановка диагностического worker не удерживает процесс.
Listeners и таймеры очищаются. Acceptance timeout и playback/retry assertions
не менялись.

Управляемая проверка с настоящим Chrome прошла: зависший HTTP body,
закрытое окно, отказ IndexedDB и отсутствующая SQLite не помешали сохранить
остальное evidence. Это инъекция fault, не естественное воспроизведение
старого process-timeout. Артефакт worker:
`.test-data/pulse-diagnostics-browser-HhdFyj/checkpoint-failure.json`.
Добавлена проверка уже отменённого SQLite probe.
Node-тесты подключены к обычному `npm test` через Vitest bridge.
ESLint настроен для browser/Node globals в `.mjs` tests, без отключения правил.

## B. Constructor/shutdown cleanup

Reconciliation jobs/history теперь выполняется до запуска Workers.
При ошибке construction Catalog закрывается; при частичном старте workers
ownership удерживается до подтверждённого termination.
Catalog закрывает собственную SQLite при ошибке внутри конструктора.
Default `new Workers()` сохраняет два workers; сервис использует deferred start.

Если cleanup/termination отклоняется, owner остаётся достижимым через
retention Set, включая принудительный GC: случайная сборка объекта не
освобождает lock, пока worker ещё может работать. Нормальный успешный cleanup
удаляет retention entry. Автоматического повторного release при неизвестном
состоянии нет; завершение процесса освобождает OS locks.
Normal close больше не делает unconditional unlock при rejected termination.

Девять real-child fault cases покрывают jobs/history read/write, Catalog
constructor, options getter, второй Worker spawn, rejected rollback/shutdown;
проверяются data preservation, natural exit, restart и ownership timing/GC.
Ревью B одобрило.

Во время worker-прогонов один incremental-scan test встретил Windows EPERM
при rename изолированной fixture; одиночный адресный повтор прошёл.
В финальном parent suite этот тест прошёл без изменения timeout/retries.
Миграционный тест сначала не запускался из isolated worktree из-за hardcoded
local TypeScript path. Исправлен resolve exported typescript/package.json
с последующим bin/tsc; все три migration tests прошли.

## C. Mutation cohort: реализован, полный результат NOT RUN

Добавлен отдельный `--mutations-only`: 30 свежих owned fixtures на dataset,
по одному настоящему ingest → clear → recovery chain на fixture.
Smoke — одна fixture на dataset. Setup исключён из итоговых summaries.
Новая history generation, уникальные events, baseline sentinel/масштаб,
totals и bounded page requests проверяются evidence validator.

Probe перед readiness проверяет точные title, выбранную карточку и её day,
отрендеренные statistics. Дата выбранной карточки не равна автоматически
дате левого края viewport slider: первая smoke-попытка ошибочно смешивала
эти понятия и завершилась timeout. Исправлен harness, не production UI.
После исправления Chrome smoke обоих dataset PASS:
`.test-data/pulse-p1-ui-2tVs3q/summary.json`.
Первый FAIL сохранён: `.test-data/pulse-p1-ui-OwPGNu/summary.json`.

После clear измеряется empty history, после recovery — один реальный album;
они не выдаются за десять лет. Каждый следующий независимый chain начинается
с новой offline generated fixture, не заменой живой SQLite.
Retained-copy preflight учитывает 60 copies и передаёт budget image seeder.
Для packaged launches записываются executable и app.asar hashes.
Ревью нашло отсутствие app.asar hash в раннем snapshot; это исправлено
до полного cohort. Проверки budget, повторных events/generations/fixture,
oversized pages и stable-old-stat readiness покрыты девятью тестами.

**Полный packaged mutation cohort завершён на `9e3b011`**;
результаты и пределы приёмки ниже. После последнего изменения
cleanup SQLite worker также не повторялись process/desktop commands;
их предыдущие успешные результаты ниже относятся к указанному snapshot.

## Выполненные проверки

- Последний `npm test`: **59 файлов / 472 теста PASS**; bridge дополнительно
  запускает Node diagnostics tests с реальным controlled browser.
- `npm run build`, `npm run lint`, `npm run format:check`,
  `git diff --check`: PASS после последних исходных изменений.
- Лог: `.test-data/pulse-p1-stage6-final/commit-checks.log`.
- Fixtures и verify:tags: PASS, семь форматов; обновилась дата настоящего report.
- До последней маленькой правки отмены diagnostic worker:
  `test:pulse:publication` PASS, три SIGKILL цикла,
  `.test-data/pulse-publication-crash-UKjaXl`.
- `test:pulse:process` PASS Chrome/Edge, четыре суммы
  **62 423 / 61 663 мс**, по два intervals:
  `.test-data/pulse-process-tX4oYG`.
- Свежий `test:pulse:desktop` PASS:
  `.test-data/pulse-desktop-DDapSM`. Checkpoint **14 934 мс** восстановлен
  точно, observed tail **4652,374 мс**; pending **15 019 мс**,
  restored **29 953 мс**, replay once; два playing sessions,
  точная сумма **68 058 мс**.
- `benchmark:pulse:ingest` PASS:
  `.test-data/pulse-p1-ingest-ZOOwoi`. 855 images / 8 790 222 bytes,
  staging 0, overlapping read p95 **30,672 мс**, 1797 requests;
  sampled WAL peak **4 396 072 bytes**. Generated workload, не originals.
- Лог reliability: `.test-data/pulse-p1-stage6-final/reliability.log`.

**Полный `npm run test:e2e` на шестом этапе теперь PASS: 144+144**,
подробности завершающего прогона ниже. Прежний результат пятого этапа
не использовался вместо новой проверки lifecycle.
Длительные memory и physical sleep не повторялись: соответствующие
cache/layout/recorder/sleep правила не менялись.

## Следующий автономный блок

См. [план завершения измерений и gate](../docs/pulse-autonomous-validation-plan.md).
Измерения и локальный correctness gate выполнены, release gate остаётся открыт
для originals, installed/manual, финального CI и согласованной интеграции.
Оригинальные process/Edge outliers остаются необъяснёнными;
успешные повторные прогоны не означают исправление причины.

## Продолжение на `9e3b011`: полный packaged mutation cohort

Свежий `npm run desktop:pack`, затем точный
`npm run test:pulse:ui -- --smoke --mutations-only --electron` — PASS,
`.test-data/pulse-p1-ui-9X8IK0/summary.json`.

Первая полная попытка — `.test-data/pulse-p1-ui-6gzjhr/summary.json`,
exit 1 на ordinary launch 20/30: нарушен native foreground invariant
во время recovery. Серия не принята; неполные quantiles не выданы за PASS.
Отклонённый sample не был сохранён с native snapshots — ограничение harness;
точную причину потери focus из этого artifact установить нельзя.
Проверки/пороги не ослаблялись.

После явного согласования пользователем foreground-сеанса повторена точная
команда `npm run test:pulse:ui -- --mutations-only --electron`:
**exit 0, completed=true, 60 launches**.
Evidence: `.test-data/pulse-p1-ui-GGXYvg/summary.json`,
лог `.test-data/pulse-p1-stage6-completion/mutations-authorized.log`.
По 30 независимых fixtures каждого dataset и 30 samples каждой mutation-группы;
все generation/event/seed/state/page-limit проверки прошли.

| Seed / измеряемое состояние | dataReady median / p95 / max, мс | coversReady median / p95 / max, мс |
| --------------------------- | -------------------------------- | ---------------------------------- |
| ordinary / listening        | 32,0 / 38,4 / 38,5               | 45,9 / 52,6 / 53,0                 |
| ordinary / clear            | 25,0 / 26,2 / 30,1               | 38,9 / 40,0 / 44,1                 |
| ordinary / recovery         | 32,0 / 38,2 / 39,5               | 45,9 / 51,9 / 53,3                 |
| ten-year / listening        | 46,2 / 58,9 / 59,7               | 60,3 / 73,8 / 73,8                 |
| ten-year / clear            | 25,2 / 25,8 / 26,0               | 39,1 / 39,9 / 41,0                 |
| ten-year / recovery         | 32,0 / 32,7 / 32,8               | 46,1 / 46,7 / 46,9                 |

Все dataReady p95 ниже warm guide 100 мс. После clear измеряется пустая история,
после recovery — один album: названия dataset описывают исходный seed.
Generated images, CDP rendering opportunity; не hardware paint, actual audio,
originals, GPU memory или installed/manual acceptance.

Отдельная исполняемая проверка сравнила identity tuple всех 60 runs и smoke:
resolved executable path, executable/app.asar SHA-256, version, commit,
Electron version совпали; каждому manifest соответствует один run root.
Результат `.test-data/pulse-p1-stage6-completion/accepted-mutation-evidence.json`.
Executable SHA-256:
`8da9e9efb4479229744ec229fe6f6ab1d40bbd5ec628aaf44c0614f7ac2d5499`;
app.asar:
`ec17bad654c6fbfff5f6210dec610d28020c3bf8c4fd9b3b9bbce8b26901780b`.
Version 0.3.0-beta.4, commit 9e3b011, Electron 44.4.1.
Это не recursive identity всех sidecars/app.asar.unpacked.

В foreground-сеанс parent не запускал параллельные проверки.
Независимый correctness reviewer был поставлен на паузу; подтверждение
пришло после команды и сообщает, что build завершён и дальнейшие команды
не запускались. Точный момент окончания чужого build относительно начала
cohort не измерен; абсолютную гарантию отсутствия внешней нагрузки не заявляем.

Статическое ревью подтвердило budgets и структуру mutation proofs.
Замечание о silent SQLite-worker exit исправлено settle-once обработчиком:
unexpected exit отклоняет probe, result/abort listeners снимаются,
late error после cancellation поглощается без удержания parent.
После правки Node diagnostics tests **6/6 PASS**, включая actual injected Chrome.
Полный correctness gate на этой маленькой последующей правке выполняется
отдельно; ранее принятый packaged cohort не объявляется новым product build.

## Завершающий correctness gate

Независимый reviewer на `9e3b011` с последней diagnostics-only правкой:
fixtures PASS; verify:tags **7/7**; `npm test` **59 файлов / 472 теста**;
build/lint/format PASS; точный полный `npm run test:e2e`
**Chrome 144/144 (4,9 мин), Edge 144/144 (4,8 мин)**, без filters/skip
или изменения test timeout. Publication PASS:
`.test-data/pulse-publication-crash-DlkqGm`; browser process PASS:
`.test-data/pulse-process-G0GNcJ`, по два intervals/tracks/sessions/visits.

Diagnostics helper SHA-256 до/после совпал:
`3dd3a1817f9dc5e22520f4399534ae1978bb57b9be76f9e8afb7a869f25aea43`.
В report verify:tags изменена только дата на `2026-10-16T15:03:54.689Z`,
SHA-256 `35e4f9710c771f239540c2890a7f4302c95b3fe5f6bb0314dbd681377420d031`.
Логи reviewer и manifests:
`.test-data/correctness-gate-9e3b011-lYNqxr/`.

Desktop в isolated reviewer завершился exit 1 до harness: отсутствует
worktree-local `node_modules/electron/dist`, заданный в electron-builder.yml.
Ошибка окружения сохранена; настройки и assertions не менялись.
Parent выполнил точный `npm run test:pulse:desktop` в основном worktree,
где Electron distribution присутствует: **exit 0, свежий pack и harness PASS**.
Это отдельный подтверждающий прогон, а не успех первоначальной команды reviewer.
Лог `.test-data/pulse-p1-stage6-completion/desktop-final.log`,
evidence `.test-data/pulse-desktop-mgqHEH/evidence.json`.
Checkpoint **15 034 мс** восстановлен точно, observed tail **4334,141 мс**;
pending **30 074 мс**, restored **45 108 мс**, replay once;
два действительно playing sessions, точная сумма **83 523 мс**.
Parent `git diff --check` также PASS.

Полный package cohort относится к artifact до последующей правки
диагностического скрипта; production UI/lifecycle после него не менялись.
Недоступность local electronDist в isolated checkout остаётся ограничением
переносимости packaging-команды, не скрыта подменой конфигурации.
Прежний silent-exit сценарий исправлен по review, но отдельная управляемая
инъекция silent worker exit ещё не добавлена; реальные error/cancel paths
проверены шестью Node tests.

Остаются внешние gates: permitted originals/actual artwork storage,
installed/manual/physical input, CI на финальном SHA и разрешённая интеграция.
Исторические process timeout и Edge startup хвост остаются INCONCLUSIVE.
Ни установка, ни push, ни миграция рабочего lock, ни релиз не выполнялись.
