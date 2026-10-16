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

**Полный packaged mutation cohort ещё не выполнялся.**
Smoke и unit tests не закрывают p95 acceptance. После последнего изменения
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

**Полный `npm run test:e2e` на шестом этапе ещё NOT RUN.**
Принятый 144+144 из пятого этапа не переносится автоматически на новый lifecycle.
Длительные memory и physical sleep не повторялись: соответствующие
cache/layout/recorder/sleep правила не менялись.

## Следующий автономный блок

См. [план завершения измерений и gate](../docs/pulse-autonomous-validation-plan.md).
До его выполнения шестой этап частично завершён, release gate открыт.
Оригинальные process/Edge outliers остаются необъяснёнными;
успешные повторные прогоны не означают исправление причины.
