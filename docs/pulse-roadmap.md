# Пульс: общий roadmap

**Pulse реализован; большой автоматический блок завершён. Релизная приёмка
ещё не закрыта.** Следующая работа — не новый круг общего полишинга,
а прохождение конкретных внешних этапов.

Это единственный актуальный roadmap Pulse. [Порядок завершения и участие
пользователя](pulse-next-steps.md) — рабочая инструкция к нему.
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
| Локальные проверки | Последний записанный correctness gate: 59 файлов / 472 теста, build/lint/format, fixtures/tags, полный e2e 144 Chrome + 144 Edge, publication/process и отдельный свежий desktop PASS. [Условия и ограничения](pulse/measurements/pulse-p1-stage6.md#завершающий-correctness-gate). |

Эти результаты относятся к указанным в журналах исходникам, dirty-состоянию,
окружению и hashes, а не автоматически к любой будущей сборке.
Mutation cohort снят до последующей diagnostics-only правки.

## Что осталось до закрытия

| Этап | Статус | Участие пользователя |
| --- | --- | --- |
| 1. Реальные обложки и actual storage | Выполнен bounded local cohort: 7 originals, actual Chrome/Edge storage, exact hashes/sums, UI fallback, отдельные HTTP/decode/native/GPU samples и 30/365 comparison. [Отчёт и ограничения](pulse/measurements/pulse-originals.md) | Разрешение на локальные копии и короткий foreground получено; дополнительный полный memory cohort не нужен без relevant изменения |
| 2. Установленная сборка и физическая приёмка | NOT RUN; beta 0.4.0-beta.2 опубликована для Feather с существующим тестовым профилем; FAT/exFAT — согласованный пропуск | Обновиться через beta updater, пройти checklist и доступные устройства ввода |
| 3. Остаточные риски | Старый process timeout и Edge startup хвост INCONCLUSIVE, причина не доказана | Выбрать ограниченную дополнительную диагностику или явно принять риск |
| 4. Финальная интеграция и CI | Beta 0.4.0-beta.2 на `4058653`: локальный gate, PR CI и release workflow PASS, prerelease опубликован; main не менялся | Интеграция в main отдельно не согласована; общий gate открыт до ручной приёмки и решения по рискам |

Подробные входы, критерии завершения и команды — в
[инструкции](pulse-next-steps.md). Недоступное оборудование или отсутствие
оригиналов означает NOT RUN и явное решение о границах приёмки, не PASS.

## Правило остановки полишинга

- Не повторять принятые sleep, memory, A/B, ingest и mutation cohorts без
  изменения соответствующего кода или конкретного нового дефекта.
- Исправлять подтверждённый дефект адресно, с регрессией и повтором затронутой
  приёмки. Не ослаблять assertions, пороги и timeout ради зелёного результата.
- Не начинать очередной «этап N» с новым планом. Обновлять эти два документа,
  результаты сохранять в `docs/pulse/measurements/`.
- Когда локальная работа упёрлась в originals, физическую проверку или решение
  о риске, остановиться и запросить конкретный ввод пользователя.

## После релиза, не блокирует текущую приёмку

- Смена timezone с фоновой пересборкой согласованных поколений.
- Явная retention/компактация raw-интервалов и GC неиспользуемых обложек
  только после измерений, без удаления используемых ресурсов.
- Экспорт/импорт истории, если понадобится.
- Политика единственного активного playback-сеанса между окнами, если нужна.

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
