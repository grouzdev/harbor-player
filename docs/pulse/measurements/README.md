# Пульс: сохранённые измерения

Это доказательства прошлых прогонов, не параллельные планы.
**Текущий статус — в [roadmap](../../pulse-roadmap.md), следующий шаг — в
[инструкции](../../pulse-next-steps.md).**

| Журнал | Зачем сохранён |
| --- | --- |
| [P0](pulse-p0.md) | Recorder/delivery/migration, process/desktop, физический sleep/wake и ограничения |
| [P1](pulse-p1.md) | Исходные UI/ingest измерения и единственный заполняемый installed/manual checklist |
| [P1 follow-up](pulse-p1-followup.md) | Диагностика foreground/layout, первые memory и ingest результаты |
| [Этап 2](pulse-p1-stage2.md) | Принятые foreground cohorts, layout/concurrency, navigation, retries |
| [Этап 3](pulse-p1-stage3.md) | Eager/lazy A/B, Edge-диагностика, раздельные native-memory cohorts, actual storage baseline |
| [Этап 4](pulse-p1-stage4.md) | E2e regression, generated artwork integrity, crash publication |
| [Этап 5](pulse-p1-stage5.md) | Ownership, owned-staging recovery, взаимодействия, startup и последующие исправления |
| [Этап 6](pulse-p1-stage6.md) | Lifecycle/diagnostics, полный packaged mutation cohort и завершающий correctness gate |
| [Разрешённые originals](pulse-originals.md) | Локальный permitted fixture, actual storage и отдельная image/native/GPU диагностика; статусы внутри |

Журналы перенесены из `verification/`; численные результаты, неудачные попытки,
SHA/dirty, hashes, окружение и ограничения сохранены. Удалённые старые планы
заменены ссылками на актуальные документы. Внутри отчётов сохранена хронология:
ранний NOT RUN может иметь завершение ниже или в следующем журнале.
Это не текущий список незавершённых работ.

Пути `.test-data/...` — ссылки на локальные raw artifacts исходных прогонов.
Они не означают, что эти файлы доступны в каждом checkout, и при этой уборке
их доступность не проверялась. Private originals/traces сюда не копируются.
Короткий actual playback baseline не доказывает годовой рост и не закрывает
пользовательские originals; методика — [playback/storage](../playback-storage.md).

При добавлении новых измерений указывать команду, exit/status, source SHA/dirty,
artifact identity, окружение, числа, raw evidence и пределы вывода.
Обновлять этот индекс и статус в roadmap, не создавать ещё один план.
