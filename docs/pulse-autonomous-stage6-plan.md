# Пульс: шестой этап без участия оператора

База — `8662de66da5b472947e980cbc8a18e0774f2a9fe`,
`wip/pulse-p1-followup`. Продолжение
[пятого этапа](../verification/pulse-p1-stage5.md) и
[общего плана закрытия релиза](pulse-release-completion-plan.md).
Это план работ, не подтверждение новых проверок.

## Цель и границы

Закрыть проверяемые автоматически пробелы надёжности и evidence, не имитируя
ручную приёмку. На базе уже приняты 453 unit tests, полный e2e 144+144,
process, publication и packaged desktop. Перезапускать всё с нуля вместо
работы над конкретным пробелом не требуется.

Не нужны пользовательские файлы, установка, устройства ввода, sleep/wake,
миграция рабочего server.lock, push или публикация. Все данные и процессы
создаются только в собственных изолированных каталогах.
Рабочую БД, profile, часы и power settings не менять.
Зависимости разрешать через Node: наличие локального node_modules не предполагается.

Порядок: **A и B независимо → C на окончательном production-коде → D**.
Не запускать latency cohort одновременно с build, e2e или другими нагрузками.
Новый журнал `verification/pulse-p1-stage6.md` создавать при выполнении,
с фактами и ограничениями, не с заранее проставленными PASS.

## A. Проверить и сделать отказоустойчивым checkpoint failure-capture

### Подтверждённый пробел

В пятом этапе добавлен `checkpoint-failure.json`, но этот путь ещё не
исполнялся при новом отказе. Сейчас catch сначала ждёт все response reads,
затем собирает SQLite и оба окна через общий Promise.all. Один зависший
response/body, недоступное окно/IndexedDB или ошибка SQLite может помешать
сохранению остальных evidence и скрыть исходный timeout.

Точки: `scripts/pulse-process-check.mjs` и отдельный небольшой helper/tests,
если выделение нужно для детерминированной проверки.

### Работа

1. Воспроизвести failure-capture управляемыми faults в тестовом driver:
   ожидающий body, закрытое окно, ошибка чтения outbox, ошибка открытия SQLite.
   Не вводить переключатели fault injection в production recorder/API.
2. Независимо собирать доступные части; сохранять явные probe errors,
   missing/timeout и стабильный идентификатор окна. Отсутствие данных не
   заменять пустым успешным результатом.
3. Ограничить время диагностики отдельным общим бюджетом. Этот бюджет
   не меняет acceptance timeout ожидания checkpoint. Таймеры и listeners
   освобождать, сохраняя первоначальную причину отказа.
4. Сохранить failure artifact до teardown даже при частичной диагностике.
   Проверить его JSON/schema и наличие original error/cause.
5. Выполнить один управляемый интеграционный failure-capture с настоящим
   браузером и обычный точный `npm run test:pulse:process`.

### Приёмка

Доказано, что диагностика не зависает, сохраняет доступные данные обоих окон
и не превращает failed scenario в PASS. Обычный process-прогон всё ещё требует
два реальных playback-окна, настоящие checkpoints/outage/restart, точные
ledger/day/album sums и idempotent retry.

**Не обещать:** это не исправление исходного timeout
`.test-data/pulse-process-2vAATa`. Для него не установлена причина.
Если failure воспроизводится естественно — разбирать по новому evidence;
если нет — оставить INCONCLUSIVE, не запускать бесконечные повторы.

## B. Закрыть constructor-reconciliation cleanup

### Подтверждённый пробел

`MusicService` создаёт Catalog и Workers в constructor, а восстановление
jobs/history выполняет после защищённого блока. Ошибка чтения/сохранения
этих записей может оставить ownership и workers без доступного владельца
объекта. Исправленный в пятом этапе createApp catch не может закрыть
конструктор, который не вернул объект.

Точки: `src/server/service.ts`, при необходимости `workers.ts`,
`tests/pulse-startup-lifecycle.test.ts`, service/local-server tests.

### Работа

1. Добавить детерминированные ошибки jobs/history read/write после открытия
   каталога. В отдельном child-процессе проверить завершение, отсутствие
   оставшихся workers и возможность следующего владельца захватить data dir.
   Ошибка не должна повреждать или сбрасывать исходные данные.
2. Проверить фактические call sites constructor/initialize и контракт
   восстановления interrupted jobs/operations, включая прямое создание сервиса
   в tests и scripts.
3. Предпочесть минимальную перестановку синхронного reconciliation до запуска
   Workers и явный rollback приобретённых ресурсов. Не выпускать ownership,
   пока ресурс ещё способен выполнять работу.
4. Проверить остальные fallible шаги construction на ту же проблему.
   Не переносить reconciliation в initialize без проверки потребителей:
   это меняет наблюдаемое поведение прямого создания сервиса.
5. Если для безопасного решения требуется новый публичный async factory
   или большая переделка Workers, остановить эту часть и описать альтернативы
   вместо незапрошенного API-рефакторинга. A и C от этого не блокируются.

### Приёмка

После каждой проверяемой ошибки старта ресурсы освобождены, исходная ошибка
не потеряна, второй экземпляр не запускается до безопасного завершения cleanup.
Happy path и прежние initialize/close/ownership/crash регрессии сохранены.
Одного теста «ошибка выброшена» недостаточно: нужны resource/restart assertions.

## C. Полноценные UI samples после мутаций истории

### Подтверждённый пробел

Существующий `mutationSamples` в `scripts/pulse-ui-benchmark.mjs` уже использует
настоящий HTTP ingest/clear. Не реализовывать его заново. Но в предыдущем
evidence listening/clear/recovery представлены одиночными samples;
они не подтверждают p95 для этих сценариев.

Точки: UI benchmark/options/evidence, dataset fixtures и их tests.
Production UI менять только при доказанной регрессии.

### Работа

1. Выделить самостоятельный ограниченный mutation cohort без 30-минутной
   navigation и без тяжёлых traces в latency samples.
2. Для ordinary и ten-year собрать не менее 30 сопоставимых samples каждого
   варианта: warm-after-listening, warm-after-clear, warm-after-clear-recovery.
   Каждому listening sample предшествует новый реальный ingest, каждому clear —
   новая смена generation. Не считать многократный warm после одной мутации
   независимыми mutation samples.
3. Сохранять исходный масштаб fixture там, где он является условием сценария.
   После clear пустая история закономерно пуста; маленький recovery dataset
   не выдавать за десять лет. Перед следующим независимым sample восстанавливать
   собственную baseline fixture вне измерительного окна и подтверждать её.
   Использовать существующий generator в новом owned data dir либо согласованный
   offline snapshot при остановленном сервере; не заменять живую БД и не копировать
   SQLite без учёта WAL.
4. Для каждого sample сверять generation, выбранную date/album, totals,
   empty/ready state, отсутствие старых cards/stats и bounded request sizes.
   Ingest/clear/recovery выполнять через существующий настоящий API,
   а не подменой aggregate rows во время измерения.
5. Не менять смысл dataReady/coversReady, nearest-rank quantiles или пороги.
   Ready-panels и startup-overlap по-прежнему отчётно разделены.
6. Сначала smoke/test самого cohort, затем финальный packaged run
   с executable/app.asar/source hashes, raw samples и окружением.
   Новые CLI options документировать точными командами после реализации.
   Preflight retained-copy/bytes/free-space budgets должен учитывать новые counts;
   не отключать лимиты существующего harness и не терять raw evidence.

### Приёмка

Таблица count/median/p95/max для каждого сценария/dataset, raw evidence,
проверенные состояния и объяснение отклонений от warm guide <100 мс.
Generated fixtures явно обозначены; actual audio и permitted artwork
этими measurements не заменяются.

Cold guide и eager/lazy уже исследованы. Новый cold cohort нужен только
если изменился cold path. Старый Edge startup хвост не объявлять исправленным;
без нового evidence не повторять прежнюю диагностику ради зелёных чисел.
Закрытые memory cohorts без изменения cache/layout/lifetime не повторять.

## D. Финальная локальная проверка и передача

После последнего изменения исходников:

```sh
npm run fixtures
npm run verify:tags
npm test
npm run build
npm run lint
npm run format:check
npm run test:e2e
git diff --check
```

Fixtures и tag verification — настоящие prerequisites, в том числе
в isolated worktree с зависимостями из родительского каталога.
Полный e2e — обе project-команды без filters/skip/изменения timeout;
внешний лимит терминала должен вмещать весь прогон.

Для A/B: точные `npm run test:pulse:process`,
`npm run test:pulse:publication`, `npm run test:pulse:desktop`.
Если B меняет ingest/lifecycle в релевантной части — повторить ingest evidence;
полный sleep/wake не нужен без изменения recorder/delivery/sleep поведения.
C проверяется отдельным принятым mutation cohort на итоговом artifact.
Тестовые faults не выдавать за естественное воспроизведение старой ошибки.

Независимый reviewer проверяет cleanup/ownership и корректность новых samples.
В журнал записать команды, exit/status, source SHA/dirty, hashes, число samples,
окружение и ограничения. Сводную финализацию обновлять только по evidence.
Stage complete не означает release ready или разрешение на push/установку.

## Что намеренно остаётся за пределами автономного этапа

- Permitted originals, actual artwork/storage и вывод о необходимости thumbnails.
- Installed/manual, настоящий trackpad/touch/Ctrl+wheel, physical FAT/exFAT.
- Миграция рабочего legacy server.lock.
- Интеграция с main, push, GitHub CI на финальном SHA и релиз.
- Принятие остаточного риска по невоспроизведённым process/Edge failures.
- Любые P2: retention, опубликованный artwork GC, timezone rebuild, новые функции.

Результат этапа — более надёжный lifecycle и проверенная диагностика,
полноценный mutation evidence, локальный зелёный gate и честный список
оставшихся внешних действий, а не обещание закрыть весь релиз без человека.
