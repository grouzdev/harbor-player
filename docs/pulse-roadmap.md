# Пульс: общий roadmap

**Первый этап Pulse принят пользователем на 0.4.0-beta.2** с согласованными
ограничениями и остаточными рисками. Нового круга общего полишинга не нужно.
Приёмка беты не является решением о signed stable.

Это сводка принятого этапа. [Итог и правила продолжения](pulse-next-steps.md),
[единый бэклог](backlog.md) — текущие источники статуса и открытых работ.
Статус дополнен permitted-originals измерениями на dirty `2742aed`;
artifact identity и границы новых runtime-проверок — в
[отчёте originals](pulse/measurements/pulse-originals.md).

## Что уже сделано

| Область | Состояние и доказательства |
| --- | --- |
| История и запись | Recorder, IndexedDB outbox, идемпотентные revisions, SQLite-агрегаты, поколения очистки и архив обложек реализованы. [P0](pulse/measurements/pulse-p0.md) закрыт, включая физический S3 sleep/wake. |
| Интерфейс | Самостоятельный режим, виртуальная лента, дни/альбомы/статистика, полоса годов, сохранение состояния и keyboard/focus-проверки реализованы. [Этапы 2–4](pulse/measurements/README.md). |
| Скорость и память | Есть foreground cold/warm/return, eager/lazy A/B, navigation и два раздельных 30-минутных native-memory cohort. Это не проверка памяти с пользовательскими изображениями. [Этап 3](pulse/measurements/pulse-p1-stage3.md). |
| Владение и recovery | SQLite ownership, консервативная уборка owned staging, crash publication и startup/shutdown cleanup реализованы и проверены. [Этап 5](pulse/measurements/pulse-p1-stage5.md), [этап 6](pulse/measurements/pulse-p1-stage6.md). |
| Mutation UI | Принят packaged cohort: 60 запусков, по 30 samples listening/clear/recovery на ordinary и ten-year; dataReady p95 < 100 мс. Generated images, не originals; clear/recovery — пустая/одноальбомная история. [Числа и artifact identity](pulse/measurements/pulse-p1-stage6.md#продолжение-на-9e3b011-полный-packaged-mutation-cohort). |
| Release gate | Beta.2 `4058653`: 478 tests, build/lint/format, fixtures/tags, полный e2e 156 Chrome + 156 Edge, packaged/portable smoke и release CI PASS. [Release и Feather evidence](pulse/measurements/pulse-p1.md#опубликована-040-beta2). |

Эти результаты относятся к указанным в журналах исходникам, dirty-состоянию,
окружению и hashes, а не автоматически к любой будущей сборке.
Mutation cohort снят до последующей diagnostics-only правки.

## Решение о приёмке

| Этап | Статус | Участие пользователя |
| --- | --- | --- |
| 1. Реальные обложки и actual storage | Выполнен bounded local cohort: 7 originals, actual Chrome/Edge storage, exact hashes/sums, UI fallback, отдельные HTTP/decode/native/GPU samples и 30/365 comparison. [Отчёт и ограничения](pulse/measurements/pulse-originals.md) | Разрешение на локальные копии и короткий foreground получено; дополнительный полный memory cohort не нужен без relevant изменения |
| 2. Установленная сборка и физическая приёмка | Принята с ограничениями: Feather beta.2 — updater, основные ручные блоки, физический тачпад, artifact identity и installed error/fallback | PARTIAL/NOT RUN в checklist сохранены; исключения приняты для первого этапа, перенесены в бэклог |
| 3. Остаточные риски | Приняты для первого этапа; process timeout/Edge хвост не объявлены исправленными, silent worker exit injection NOT RUN | Дальнейшая адресная диагностика по условиям PULSE-01–03 в бэклоге |
| 4. Финальная интеграция и CI | Beta.2 опубликована; merge текущей ветки в main разрешён пользователем | Проверить CI результата интеграции; это не новый релиз |

Итог и правила повторов — в
[инструкции](pulse-next-steps.md). Недоступное оборудование или отсутствие
оригиналов означает NOT RUN и явное решение о границах приёмки, не PASS.

## Правило остановки полишинга

- Не повторять принятые sleep, memory, A/B, ingest и mutation cohorts без
  изменения соответствующего кода или конкретного нового дефекта.
- Исправлять подтверждённый дефект адресно, с регрессией и повтором затронутой
  приёмки. Не ослаблять assertions, пороги и timeout ради зелёного результата.
- Не начинать очередной «этап N» с новым планом. Задачи добавлять в бэклог,
  результаты сохранять в `docs/pulse/measurements/`.
- Когда локальная работа упёрлась в originals, физическую проверку или решение
  о риске, остановиться и запросить конкретный ввод пользователя.

## Дальнейшие расширения

Timezone, retention/GC, экспорт/импорт и политика playback-сеансов перенесены
в [бэклог](backlog.md#расширения-пульса--без-обещанного-срока).

Новые режимы дизайна, дневные/периодные рейтинги и переписывание режима обложки
в текущий объём не входят.

## Где искать детали

- [Технические правила Pulse](pulse/reference.md).
- [Индекс сохранённых измерений](pulse/measurements/README.md).
- [Методика actual playback/storage](pulse/playback-storage.md).
- [Мокапы](mockups/pulse.md) — история дизайна, не текущий backlog.

Восемь перекрывающихся планов реализации/P0/P1/follow-up/finalization/release/
autonomous удалены: выполненные пункты не должны выглядеть незавершёнными.
Исходные версии доступны в Git; важные результаты и ограничения сохранены.
