# Пульс P1: следующий этап доработок

Продолжение [журнала](pulse-p1-followup.md) и
[плана D1–D5](../docs/pulse-p1-followup-plan.md). Это результаты автоматических
проверок, не установленная ручная приёмка и не разрешение на релиз.

## Сборка и границы

- База: `b967ca6e538b160edf5f208ac4f718a83da8afbf`,
  `wip/pulse-p1-followup`, **dirty**: изменения этого этапа не закоммичены.
  `main` остался на `690afd0`; merge/push/установка не выполнялись.
- Windows `10.0.22621`, Node `24.20.0`, Electron `44.4.1`,
  Edge `155.0.4283.45`, Intel i7-11700F, 64 GiB RAM.
  Посторонняя нагрузка не контролировалась; проверки шли последовательно.
- Свежий `desktop:pack`: версия `0.3.0-beta.4`, build commit `b967ca6`.
  Packaged executable SHA-256:
  `fa5cd886b13bf90340e58cc2b6ab80f24864d9543f6944367bf1a4bf38644e27`.
  Node executable SHA-256:
  `5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5`.
- Raw UI evidence содержит SHA/dirty/source hashes, executable hash и app info;
  ingest — source/executable hashes. Контекст финальной последовательности
  дополнительно записан в
  `.test-data/pulse-p1-stage2-final-5xgzME/provenance.json`.
  Это идентификация dirty-артефактов, не проверка будущего финального SHA.
- Все данные и процессы — собственные `.test-data`; рабочая v13, обычный
  Electron profile, часы и power settings не менялись.
  Artwork — generated PNG, не реальные пользовательские originals.

## D1/D2: latency и ограниченные layout reads

Первый повтор на неизменённой базе:

```sh
npm run test:pulse:ui -- --latency-only --channel=msedge --cold=ready-panels
```

`.test-data/pulse-p1-ui-U3VEmg/summary.json`: cold p95 ordinary **102,4 мс**,
ten-year **187,0 мс**. Старые 453,5/460,9 мс не воспроизвелись, но ten-year
warm p95 оказался **113,4 мс**, выше ориентира.

Отдельные diagnostic smoke, не budget samples:

```sh
node scripts/pulse-ui-benchmark.mjs --smoke --latency-only --diagnostic --channel=msedge --cold=ready-panels
```

Evidence: `.test-data/pulse-p1-ui-{JB64FM,EOmjli,fr1Zkp,PPYg00,Hft41P,woSy0S}`.
Traces сохранены в соответствующих dataset directories.

| Cold sample     | Shell DOM, мс | Cards/stats DOM, мс | Первый RAF, мс | dataReady, мс |
| --------------- | ------------- | ------------------- | -------------- | ------------- |
| JB64FM ordinary | 4,2           | 56,2                | 25,3           | 92,3          |
| JB64FM ten-year | 4,8           | 86,4                | 9,7            | 126,5         |
| fr1Zkp ten-year | 5,1           | 154,8               | 144,3          | 193,1         |

В последнем sample нет longtask entries: ранний shell DOM и поздний RAF
не доказывают длительный React render или медленный SQLite. Причина прежнего
Edge хвоста >400 мс **не установлена**; новый проходящий p95 его не стирает.

В ten-year повторном входе отдельно видны десять последовательных layout
окон: в JB64FM warm sample от первого layout start до последнего response end
около **29,4 мс**. Убрана эта сериализация: максимум три свежих metadata read
одновременно. Карточки и изображения вне viewport не загружаются.
Результаты сохраняют порядок окон; `PulseLayout` по-прежнему сортирует дни.
При abort/error соседние reads отменяются; кэш metadata не добавлен.
Listening/settings/clear сохраняют существующее обновление и generation checks.

Первый after `.test-data/pulse-p1-ui-xexayG`: ten-year cold p95 **125,3 мс**,
warm **96,8 мс**. Это измеренный выигрыш длинной истории, не объяснение
startup/RAF хвоста. Eager import и bundle warning threshold не менялись;
отдельное startup-cost A/B не выполнялось.

### Финальные foreground cohorts после последнего изменения исходников

По 10 cold, 30 warm-immediate и 41 return на dataset; raw median/p95/max,
shell/covers readiness и все slow samples сохранены.

```sh
npm run test:pulse:ui -- --latency-only --electron --cold=ready-panels
npm run test:pulse:ui -- --latency-only --channel=msedge --cold=ready-panels
```

| Target / dataset    | cold dataReady p95, мс | warm p95 | return p95 |
| ------------------- | ---------------------- | -------- | ---------- |
| Electron / ordinary | 106,7                  | 64,7     | 63,3       |
| Electron / ten-year | 126,3                  | 96,3     | 63,3       |
| Edge / ordinary     | 160,8                  | 64,3     | 63,7       |
| Edge / ten-year     | 177,3                  | 96,8     | 63,6       |

Electron: `.test-data/pulse-p1-ui-m7uEmH/summary.json`;
Edge: `.test-data/pulse-p1-ui-6Nuoh3/summary.json`.
Guide applicable в этих cohorts; installed acceptance остаётся NOT RUN.
Edge ordinary warm max **263,5 мс** сохранён, хотя p95 ниже 100 мс.
TTL/listening/clear/recovery — одиночные отдельные samples, не p95 acceptance
этих вариантов и не actual audio recorder.

## Обнаруженная e2e-регрессия: Tab reentry

Первый полный `npm run test:e2e`: Chrome 140/140, Edge 139/140.
После rank 999 → Tab на slider → Shift+Tab фокус возвращался на rank 993.
Blur очищал ref, и последующая перерисовка меняла roving Tab entry.

Тест усилен изменением viewport после Tab и проверкой `tabindex="0"` rank 999:
на старой реализации воспроизводимо получал `-1`. Теперь последний rank
сохраняется как scalar state, пока он в текущем viewport/overscan.
Ушедшая за окно карточка из-за этого не удерживается в DOM.
Финальный общий e2e после всех production-изменений прошёл полностью.

## D3: нагрузка, publication errors и bounded retry

Harness сохраняет прежнюю 45-сценарную матрицу, явно называя её
`read-load-period`, а не гарантированным overlap каждого короткого запроса.
Добавлены:

- isolated `100/first-copy/new`, три повтора, уникальные event/album/visit IDs
  и отдельные 300 source images, после завершения catalog readers;
- фактический read overlap каждого батча на одних parent HTTP часах;
  отдельные `observedOverlapScenarios`, strict half-open intervals;
- filesystem publication/error outcomes и observed last-copy-slot tail,
  не заявление о полном причинном critical path;
- точные count/bytes/staging gates и `matrix-diagnostic.json` **до** assertions,
  чтобы не терять причину неуспешного прогона.

Новые gates обнаружили потери публикации:

- `.test-data/pulse-p1-ingest-48YPc7`: **659 вместо 663** изображений
  после матрицы; четыре isolated source images существуют, архивов нет.
  Этот запуск не успел сохранить spans; причина его отдельных ошибок неизвестна.
- `.test-data/pulse-p1-ingest-XD9ySI/matrix-diagnostic.json`:
  **660 вместо 663**; три isolated directory rename завершились `EPERM`.
  Под read-load тоже были `EPERM`, но последующие revisions повторяли copy
  и маскировали отсутствие после первого ACK. Оба прогона — FAIL, не PASS.

Минимальный storage fix: повторять только rename готового staging directory
для `EPERM`/`EBUSY`/`EACCES`, максимум четыре попытки, backoff 20/40/80 мс.
Copy не повторяется внутри попыток, SQLite-транзакция остаётся синхронной
и начинается после preparation. Исчерпание сохраняет best-effort поведение
и cleanup; последующий retry события может снова опубликовать обложку.
Непустой опубликованный archive не заменяется.

`npm run benchmark:pulse:ingest` после исправления — PASS,
`.test-data/pulse-p1-ingest-PlNodh/result.json`:

| 100 first-copy/new, n=3               | HTTP median / p95 / max, мс | Transaction median / p95, мс |
| ------------------------------------- | --------------------------- | ---------------------------- |
| Read-load period, фактический overlap | 1337,34 / 1523,65 / 1523,65 | 33,02 / 34,30                |
| Isolated, без catalog reads           | 141,85 / 148,03 / 148,03    | 41,17 / 59,59                |

Residual median: **1285,20 / 69,53 мс** соответственно.
Это сильное различие окружения read-load, не доказательство ускорения продукта
и не полный причинный trace. Порядок фиксирован, caches не сбрасываются,
worker инструментирован; n=3, p95 равен max. Concurrency не перенастраивалась.

В isolated cohort один реальный `EPERM` восстановился следующим rename.
Все **855 images / 8 790 222 bytes**, staging **0**, exact publication gates
прошли. Overlapping catalog read p95 **33,029 мс**, 2188 reads, ниже 50 мс.
Общего снижения first-copy ACK под read-load не заявляем.

## D4: финальные navigation и storage

Точная команда `npm run test:pulse:ui -- --electron` завершилась exit 0:
`.test-data/pulse-p1-ui-ia0l0j/summary.json`.

| Dataset  | Navigation | Points | Max days/cards | Page limits |
| -------- | ---------- | ------ | -------------- | ----------- |
| Ordinary | 1800 с     | 16 590 | 5 / 8          | Все ≤100    |
| Ten-year | 1800 с     | 27 521 | 10 / 12        | Все ≤100    |

Оба navigation record `completed=true`; bounded DOM и page limits проверены.
Longtask observer: 0 entries >50 мс; это не GPU/frame smoothness proof.
Start/end traces и heaps сохранены локально. Network-enabled memory этого
cohort не заменяет чистое native-memory измерение из предыдущего этапа.
Чистый `test:pulse:memory` заново не запускался; прежний завершённый cohort
остаётся evidence прежней сборки, не автоматически этой.

Startup-overlap сохранён отдельно: cold dataReady p95 **209,9 / 209,4 мс**,
guide к нему не применяется. Он не смешивается с foreground таблицей.

Годовая модель:

```sh
PULSE_BENCH_DAYS=365 npm run benchmark:pulse:ingest
```

`.test-data/pulse-p1-ingest-W6BNN4/result.json`, exit 0.
Env assignment только для этой команды, persistent переменная не оставлена.
Exact final sums всех четырёх слоёв — **2 672 386 000 мс**.
12 342 intervals, 3593 albums, 366 active days, 7961 day-albums;
2865 images / **29 443 361 bytes**, staging 0; peak sampled WAL **4 548 512 bytes**.
Overlapping read p95 **34,059 мс**, baseline **26,890 мс**.
Новая isolated матрица добавляет 300 событий и 4 500 000 мс;
разницу с прежней моделью не выдавать за изменение recorder/storage semantics.

Read benchmark: `npm run build:server && node scripts/pulse-benchmark.mjs`.
Лог `.test-data/pulse-p1-stage2-final-5xgzME/read.log`.
Миллион intervals, 10 000 albums, 1000 albums в busy day.
SQLite + JSON p95: range **0,817**, year layout **0,512**, week window **1,407**,
rank900 **0,642**, stats **0,184 мс**. Это не HTTP/React/paint.

## Итоговые проверки и оставшиеся gates

После последнего production-изменения:

| Проверка                                                         | Результат                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `npm test`                                                       | PASS: 49 файлов, 413 тестов                             |
| `npm run build`                                                  | PASS, включая typecheck                                 |
| `npm run lint`                                                   | PASS                                                    |
| `npm run format:check`                                           | PASS                                                    |
| `npm run test:e2e`                                               | PASS: общая непрерванная команда, Chrome 140 + Edge 140 |
| `git diff --check`                                               | PASS                                                    |
| `npm run test:pulse:process`                                     | PASS Chrome + Edge; `.test-data/pulse-process-bTUQYe`   |
| `npm run test:pulse:desktop`                                     | PASS; `.test-data/pulse-desktop-LKvjaH`                 |
| Full UI, final foreground latency, ingest 30/365, read benchmark | PASS исполнения; числа и ограничения выше               |

Process exact sums: Chrome **33 229 мс**, Edge **33 205 мс**.
Packaged desktop: checkpoint **15 013 мс** восстановлен точно,
pending replay once, два сеанса **68 286 мс**. Recorder/delivery и sleep
учёт не менялись; физический P0 sleep/wake не повторялся.

Остаются открытыми:

- Причина исторического Edge cold хвоста >400 мс; текущие samples в бюджете
  не доказывают её устранение. Отдельное eager/lazy startup-cost A/B не выполнено.
- Настоящие permitted originals, image/GPU memory, физические touch/trackpad/FAT;
  actual audio/storage comparison отдельно от synthetic growth model.
- Установленная manual приёмка на согласованной сборке.
- Новый CI на зафиксированном финальном SHA; будущие merge с `main`,
  push/установка требуют отдельных явных действий.
- Crash staging recovery/kill-during-copy/restart остаются отдельным follow-up.
  Bounded rename retry не является crash recovery и не добавляет retention/GC.

Сводные release/P1 чекбоксы не закрывались.
