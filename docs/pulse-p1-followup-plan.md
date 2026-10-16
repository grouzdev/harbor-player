# Пульс: план оставшихся доработок P1

Продолжение [рабочего плана P1](pulse-p1-plan.md) после реализации фиксов
и [измерений](../verification/pulse-p1.md). Это план, не подтверждение приёмки.
Исходная версия первого прогона — `14b705b`; каждый результат должен
содержать фактический SHA, executable hash и build info измеренной сборки.
Результаты выполнения: [журнал доработок](../verification/pulse-p1-followup.md).
Новый этап на базе `b967ca6`:
[изменения, измерения и оставшиеся gates](../verification/pulse-p1-stage2.md).
Продолжение на базе `f0078fc`:
[startup A/B, actual storage и завершённые раздельные memory cohorts](../verification/pulse-p1-stage3.md).
Код находится в `wip/pulse-p1-followup`; с новым `main` пока не объединялся.
Длительная navigation и чистый native-memory cohort завершены:
по 1800 секунд на оба dataset, bounded DOM и post-warmup memory проверены.
Прежние прерванные попытки остаются INCONCLUSIVE в журнале.
Непрерванный общий e2e завершён после исправления Tab reentry; новые Edge
foreground samples укладываются в ориентиры, но причина исторических cold
outliers пока не установлена. Новый CI и ручные проверки остаются открытыми.
Ниже сохранён исходный объём D1–D5; текущие числа и статусы — в журнале этапа.

## Что уже закрыто и что осталось

- P0 закрыт, включая [физический S3 sleep/wake](../verification/pulse-p0.md#физический-sleepwake-pass).
  Не повторять его как незавершённую задачу. Повтор потребуется при изменении
  recorder/delivery или поведения playback во время сна.
- Исходный CI-блокер устранён:
  [Windows CI на `0fcb964`](https://github.com/grouzdev/harbor-player/actions/runs/38303905680)
  завершился успешно. Этот run не проверяет последующие `b0f9269` и `14b705b`.
- Виртуализация, достижимость 1000 альбомов, clear/state/focus и compact geometry
  имеют регрессии. Не переписывать их вместо доработки измеренного узкого места.
- Cold dataReady p95: Chrome 537–555 мс, packaged Electron 760–781 мс
  при ориентире 300 мс. Warm/return p95 ниже 100 мс.
- Ingest: overlapping catalog read p95 37 мс; first-copy/new батч 100 events
  ждёт ACK около 1,5 с, преимущественно вне синхронной транзакции.
- Длительные navigation/native-memory cohorts завершены на указанных в журнале
  сборках. Не закрыты installed/manual, реальные обложки и часть нагрузочных
  вариантов; новый Network-enabled navigation не заменяет чистый memory cohort.

**Рекомендуемый порядок:** D1 → D2 → D4 → D5. D3 можно исследовать параллельно
после фиксации общего протокола; staging recovery — отдельный follow-up.
Не вводить новые design options, функции P2, схему БД или retention.
Рабочую v13, пользовательский profile, часы и power settings не менять.

## D1. Разобрать cold path и достоверность измерения

**Приоритет: первый релизный блокер.** Пока нельзя утверждать, что причина
в SQLite, десяти последовательных layout запросах или размере обложек:
значительная задержка наблюдается уже до shellReady.

Точки изменений: `scripts/pulse-ui-benchmark.mjs`, `pulse-ui-evidence.mjs`,
`src/client/App.tsx`, `PulseMode.tsx` и benchmark-only диагностика desktop main.

1. Обновить baseline на свежем `desktop:pack`. Разделить два сценария:
   ранняя CDP-инъекция при startup, в том числе до native show, и первое
   открытие из уже готовых видимых/focused панелей. Первый cohort диагностический:
   это не обязательно физически возможный пользовательский click.
   Второй остаётся первым входом в Пульс: не выполнять искусственный
   benchmark-прогрев его API/module/cache.
   Готовность панелей определять состоянием UI/запросов, не фиксированным sleep.
   Не удалять первый сценарий, чтобы получить зелёный бюджет.
2. В отдельном diagnostic run записать click, первый render/commit Пульса,
   history/layout/cards/stats completion, первое наблюдение готового DOM,
   следующие RAF и decode. Наблюдать visibility/focus/готовность собственного
   native окна, незавершённый bootstrap, fonts и renderer tasks.
   Не вычитать часы разных процессов без калибровки.
3. Получить короткие cold traces: fast и slow samples обоих dataset.
   Сравнить с тёплым входом и объяснить разницу smoke/full counts.
   Latency samples собирать отдельно от тяжёлого профилирования.
4. Проверить probe тестами: delayed readiness, смена cards/stats между RAF,
   отмена sample, decode failure и скрытое окно. Не выдавать ready DOM
   за аппаратный paint. Background/occlusion не скрывать специальными
   флагами отключения штатного throttling.

**Выход:** таблица фаз и конкретная причина основной доли задержки;
сопоставимые результаты в foreground и при раннем startup overlap.
Если измерение некорректно, исправить его с сохранением старого evidence
и явно записать, какие числа больше нельзя сравнивать.

## D2. Устранить доказанную причину cold latency

Выбрать минимальный фикс по D1, а не внедрять все возможные оптимизации:

| Подтверждённая причина | Направление |
| --- | --- |
| Bootstrap/commit/первый layout | Убрать повторную работу или лишний переход; не размонтировать каталог ради скорости |
| Module/Suspense или лишний startup JS | A/B eager import и безопасного предварительного module load; сохранить только измеримый выигрыш без регрессии startup |
| Последовательные layout reads действительно доминируют | Ограниченная параллельность или bounded metadata cache с generation/settings/listening invalidation и abort |
| Image transfer/decode | Использовать существующий thumbnail путь либо отдельно добавить производные изображения без потери оригинала |
| Probe/RAF timing | Исправить протокол; не называть изменение метрики ускорением продукта |

Текущий eager import убрал отдельную lazy-загрузку, но cold p95 всё ещё выше
ориентира; основной chunk 603 kB / 180 kB gzip. Проверить startup cost A/B,
не сохранять этот выбор только потому, что отдельный smoke был быстрее.
Не менять размерную warning threshold сборщика вместо анализа.

Добавить regression для найденного правила. На одинаковом окружении повторить
10 cold, 30 warm и return samples для обычной/десятилетней истории;
отдельно TTL, новые listening events и clear. Последние варианты пока
не измерены: использовать настоящий ingest/generation, не только aggregate seed.

**Приёмка foreground ready-panels:** cold dataReady p95 < 300 мс,
warm/return p95 < 100 мс,
с сохранёнными raw samples и неизменной семантикой готовности.
Ранний pre-show/startup-overlap сохраняется и отчётно отделяется; отдельный
продуктовый startup budget здесь не установлен. Изменение классификации
не является ускорением и не стирает прежние результаты.
Если объективно нужен иной продуктовый бюджет — вынести данные на отдельное
решение, не повышать порог или выбрасывать slow samples самостоятельно.

## D3. Снизить first-copy ACK latency без ослабления сохранности

**Отдельная оптимизация, не повод откладывать D1.** Для ingest не установлен
порог 300 мс: UI guide нельзя переносить на запись батча.

Точки: `src/server/pulse.ts`, `scripts/pulse-ingest-benchmark.mjs`,
`pulse-ingest-evidence.mjs`, storage/API tests.

- Разложить residual на metadata checks, queue wait, copy, publication и cleanup
  в собственном diagnostic worker. У перекрывающихся операций сумма durations
  не равна elapsed: записать concurrency и критический путь.
- Матрица 1/20/100 событий: first-copy/existing/missing, checkpoint/final/retry;
  generated и разрешённые реальные изображения разных bytes/resolution.
  Каталог baseline/overlap измерять тем же протоколом.
- Проверить fast path отсутствующего source до создания staging: отсутствие
  обложки не должно создавать лишнюю дисковую работу на каждой revision.
  Повтор после появления файла всё же должен сработать; не кешировать ошибку
  навсегда. Проверить исчезновение source между проверкой и copy.
- Если metadata/queue действительно доминируют — сократить повторную работу
  или настроить bounded concurrency по измерениям. Existing-cover ACK уже
  обходит тяжёлую очередь; сохранить этот инвариант.
- Если доминирует SQLite — профилировать statements/formatter; не дробить
  атомарный батч на частичные commit и не делать await внутри транзакции.

**Приёмка:** сравнение before/after по median/p95/max каждого сценария,
overlap read p95 < 50 мс, отсутствие ухудшения обычного playback/checkpoint,
точные суммы, неизменные ACK/generation/retry и immutable publication.
Не выполнять fire-and-forget copy после ACK: это отдельная смена контракта,
которую сейчас не рекомендуем. Физический FAT/exFAT тест publication выполнить
при доступности тестового носителя; симуляция не заменяет этот результат.

## D4. Закончить stress, artwork и storage evidence

После D2 выполнить на финальной сборке:

```sh
npm run desktop:pack
npm run test:pulse:ui -- --electron
npm run test:pulse:ui -- --latency-only --channel=msedge
npm run benchmark:pulse:ingest
```

Годовую модель — `PULSE_BENCH_DAYS=365 npm run benchmark:pulse:ingest`
в POSIX shell; в PowerShell задать `$env:PULSE_BENCH_DAYS = "365"`.
Переменную после прогона удалить. Все данные остаются в собственных `.test-data`.

Полный UI режим занимает не менее часа: по 30 минут навигации на два dataset.
Проверить не только завершение: достигнутые даты/ranks, bounded DOM и request
limits, LRU/TTL, memory before/plateau/idle, retained objects и long tasks > 50 мс.
JS heap не заменяет renderer/image/GPU memory; неподдержанное измерение
отмечать явно. Trace может быть большим: заранее проверить свободное место.
Network-инспектор сам удерживает `NetworkResourcesData`; его native-memory
график не является доказательством утечки. Чистый отдельный cohort:
`npm run test:pulse:memory` (по 1800 с на dataset), либо `-- --smoke`
для проверки harness без long acceptance. Renderer debugger не подключается.

Добавить permitted-image fixture mode с manifest bytes/resolutions и decode
errors; текущие solid PNG не доказывают работу настоящих оригиналов.
Хранить private images/traces локально, в журнал переносить только безопасные числа.
Сопоставить рост raw/index/WAL/archives 30/365 дней с коротким actual
audio/recorder прогоном; годовую модель не выдавать за год наблюдений.

**Выход:** reproducible performance/storage report и исправленные причины
отклонений. Не закрывать memory/artwork по одному smoke.

## D5. Installed/manual и финальный gate

На согласованной установленной свежей сборке заполнить
[ручной checklist](../verification/pulse-p1.md#ручная-приёмка-установленного-приложения):
режимы/focus/scroll/dialog, playback/queue, low/portrait/fullscreen,
DPI/zoom, light/dark/custom accent, длинные имена, empty/disabled/API/cover errors,
physical trackpad/touch/Ctrl+wheel. Недоступный ввод остаётся `NOT RUN`.
Новые player value bubbles из `b0f9269` проверить регрессиями общих controls;
не переносить их в Пульс как незапрошенное изменение дизайна.

После последнего исходного изменения:
`npm test`, `npm run build`, `npm run lint`, `npm run format:check`,
полный `npm run test:e2e`, `git diff --check` и UI/ingest evidence.
Если менялись ingest/lifecycle — `test:pulse:process`, `test:pulse:desktop`;
если менялся sleep/playback учёт — релевантный реальный P0-прогон.

CI требуется на финальном SHA, а не только зелёный run предшественника.
Push/установка/релиз — отдельные явные действия; план их не выполняет.
Только после принятого evidence обновить сводные чекбоксы финализации.

## Отдельно: crash staging recovery

Ни один опубликованный flat/archive ресурс не удалять как staging.
Использовать существующее эксклюзивное владение data dir и строгую проверку
owned staging names; mtime/PID без проверки владения недостаточны.
При неопределённости сохранить файл и записать диагностику.
Частично записанное изображение нельзя публиковать без проверки полноты.

Добавить реальные kill-during-copy/restart и transient sharing-error tests;
bounded cleanup retries, без бесконечных таймеров и удаления чужого live staging.
Эту работу вести отдельно от retention/GC опубликованных обложек из P2.
Если длительные прогоны обнаружат накопление staging — включить исправление
в приёмку storage; иначе не блокировать им разбор cold path.
