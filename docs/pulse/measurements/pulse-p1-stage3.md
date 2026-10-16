# Пульс P1: диагностика startup и повтор memory

Продолжение [второго этапа](pulse-p1-stage2.md) на базе
`f0078fce29e1ba20cfff9f2dccd2c842f565f801`. Изменены harness/tests, не
production-код. Измерены dirty-артефакты на этой базе;
merge/push/установка/релиз не выполнялись.
P1 и общий release gate не закрыты.

## Диагностика Edge и A–B–B–A

Добавлены bounded RAF request/fire timestamps, включая начальные два RAF,
отдельный bounded tail для decode RAF, visibility/focus transitions и корректная
атрибуция long tasks по пересечению с renderer sample. Поведение readiness не
менялось; диагностический и обычный probe проверены на одинаковой фикстуре.
`--diagnostic-runs=1..5` требует `--diagnostic --smoke`; retained fixture budget
учитывает каждый запуск. Это не latency acceptance cohort.

Локальные логи и сводка:
`.test-data/pulse-p1-stage3-7OnAuv/ab-summary.json`.
Diagnostic ready-panels: `.test-data/pulse-p1-ui-FPHRdH`;
startup-overlap: `.test-data/pulse-p1-ui-yW2EuN`.
По пять cold samples каждого dataset в каждом diagnostic cohort.
В startup trace воспроизведены ожидания первого или второго RAF примерно
118–160 мс, при shell DOM за 5–9 мс, без пересекающихся renderer tasks >50 мс
и без зарегистрированных visibility/focus transitions.
Исторический хвост >400 мс не воспроизведён и не объявляется исправленным.

Временный lazy/Suspense вариант сравнивался с исходным eager в порядке A–B–B–A.
На каждый вариант/повтор/dataset: 10 cold и 30 warm; тяжёлые traces отдельно.

| Вариант  | Cold p95 ordinary / ten-year, мс | Panels-ready p95 ordinary / ten-year, мс |
| -------- | -------------------------------- | ---------------------------------------- |
| A1 eager | 124,7 / 142,1                    | 780,2 / 807,7                            |
| B1 lazy  | 439,1 / 468,0                    | 868,5 / 845,4                            |
| B2 lazy  | 426,9 / 456,6                    | 845,3 / 877,9                            |
| A2 eager | 150,2 / 143,9                    | 832,4 / 816,9                            |

Panels-ready — renderer elapsed time от navigation origin, не аппаратный paint.
Отдельные Paint Timing entries отсутствуют в части samples; отсутствующие
entries не заменялись нулями. В lazy diagnostic
`.test-data/pulse-p1-ui-DAECaU` JS/CSS завершались около 8–10 мс, shell DOM
наблюдался около 316–318 мс при продолжающихся RAF без longtask entries.
У lazy нет устойчивого startup выигрыша и есть cold-регрессия.
Выбран исходный eager; `src/client/App.tsx` восстановлен без diff.
Это объясняет отказ от lazy, не причину исторического eager/startup хвоста.

## Actual playback / storage

`npm run test:pulse:process` после усиления проверок — PASS в Chrome и Edge:
`.test-data/pulse-process-kiWec3`.
`storage.json`, `outbox.json`, `outage.json`, `result.json` сохраняют реальные
recorder revisions, accepted/pending cutoff после остановки API, media positions,
точные ledger/day/album allocations, sampled SQLite/WAL/SHM sizes и provenance.

Для каждого трека подтверждены новый offline revision, прирост playedMs >15 000
от принятого/ожидающего cutoff и >15 секунд media progression при отсутствии API.
Chrome: outage 15 098 мс, media progression 15,101/15,102 с;
Edge: outage 15 132 мс, media progression 15,132/15,137 с.
Final sums: **61 716 / 61 375 мс** соответственно, по два intervals.
Duplicate final и stale checkpoint не изменили суммы или количество intervals.

В обоих браузерах sampled WAL: baseline **626 272 bytes**, после online
checkpoint **708 672**, после final/retry **758 112**. SQLite **4096 bytes**,
SHM **32 768**; это не WAL peak и не server-only footprint.
Без forced SQLite checkpoint; generated WAV не имеют обложек, count/bytes/staging
равны нулю. Synthetic 30/365 модели из второго этапа проверяют тот же принцип
cumulative revision вместо роста числа строк на каждый checkpoint, но другой
масштаб, распределение дат и artwork. Линейная годовая экстраполяция по этому
короткому прогону не выполнялась. Реальные permitted originals остаются NOT RUN.

## Чистый native-memory: оба набора завершены раздельно

Первый `npm run test:pulse:memory`:
`.test-data/pulse-p1-ui-memory-Z7pr03/evidence.json`.
Ordinary завершён, после чего ten-year был прерван пользователем.
Корневой raw `status=RUNNING` остался незавершённым; это не активный процесс
и не PASS общего запуска. Частичный ten-year (2479 targets) — INCONCLUSIVE.
Данные ordinary с `completed=true`, end и idle samples сохранены.

Чтобы не повторять ordinary, добавлен `--dataset=all|ordinary|ten-year`.
Default по-прежнему оба dataset; completion flags явно относятся только
к выбранным наборам. Тест выбора dataset и прежние memory-helper регрессии:
**5/5 PASS**, syntax/format/diff checks PASS.

Точная повторная команда:

```sh
npm run test:pulse:memory -- --dataset=ten-year
```

Свежий `desktop:pack`; команда завершилась exit 0.
`.test-data/pulse-p1-ui-memory-NALPRw/evidence.json`:
`status=COMPLETED`, `completed=true`, `longDurationCompleted=true`,
`datasets=["ten-year"]`. Ordinary повторно не запускался.

Оба артефакта имеют одинаковые hashes:

- executable SHA-256:
  `a138b57c22909650e833ad97a2074cdce7d93a0a647480c1942431e557d5e442`;
- app.asar SHA-256:
  `8f6444b0f7af71c71f30e18c71036d4e3b5f19db32da12e7ada5c1fa36fd61b4`.

Electron 44.4.1, app 0.3.0-beta.4, build commit `f0078fc`.

| Dataset / evidence | Длительность, с | Targets | Samples | Max days/cards |
| ------------------ | --------------- | ------- | ------- | -------------- |
| Ordinary / Z7pr03  | 1800,756        | 6820    | 122     | 5 / 8          |
| Ten-year / NALPRw  | 1803,789        | 5388    | 121     | 20 / 18        |

Во всех контрольных samples обоих завершённых наборов окно visible/focused,
не minimized; renderer debugger не подключён. Нет Playwright, renderer Network
domain или forced GC. Sentinel/date/DOM envelope assertions прошли.

Renderer private memory, **KiB**:

| Dataset  | Before | End     | После 10 с idle | Median Q1 / Q2 / Q3 / Q4              |
| -------- | ------ | ------- | --------------- | ------------------------------------- |
| Ordinary | 51 088 | 54 436  | 54 400          | 53 328 / 53 424 / 53 564 / 53 460     |
| Ten-year | 58 568 | 130 552 | 80 872          | 120 980 / 125 652 / 126 536 / 127 040 |

Q1–Q4 — последовательные окна по 7,5 минуты по periodic samples.
Ordinary стабилен; ten-year post-warmup Q3→Q4 median +504 KiB,
после idle освобождено 49 680 KiB относительно end.
В проверенном маршруте DOM и post-warmup memory ограничены.
`longAcceptance=false` сохранён: вывод основан на просмотре тренда,
не автоматическом принятии продукта по длительности.
Это не проверка всех утечек, реальных originals или GPU/VRAM.

## Gates и оставшиеся ограничения

- Финальный `npm test` после добавления dataset selector: **421/421, 51 файл**.
  Build/typecheck прошёл через `test:pulse:memory`; перед коммитом повторены
  lint, format и `git diff --check` — PASS.
- Общий `npm run test:e2e` после timezone-test исправления проходил 140+140.
  **Последний** повтор: Chrome 140/140, Edge 138/140 — FAIL двух общих library
  сценариев (`library root can be added to any playlist`, `local library…`).
  Traces сохранены в `.test-data/pulse-p1-stage3-7OnAuv/failures-final`.
  Предыдущий PASS не подменяет этот результат.
- В Pulse tests исправлена UTC/local-history date ошибка, обнаруженная после
  местной полуночи. Проверки используют часовой пояс истории и подтверждённую
  API session; unit cases включают UTC+14/UTC-12. Product clocks не менялись.
- Permitted artwork manifest, installed/manual, physical input/FAT, CI на
  финальном SHA и согласованная интеграция всё ещё требуют отдельного выполнения.

Сводные P1/release чекбоксы не закрывались.
