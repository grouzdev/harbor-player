# Пульс: завершение первого этапа

**Первый этап принят пользователем на 0.4.0-beta.2 с согласованными
ограничениями и остаточными рисками.** Общую бета-приёмку больше не держать
открытой ради непроверенных устройств или необъяснённых исторических samples.
Это не утверждение, что каждый пункт checklist получил PASS, и не stable gate.

## Что принято

- [Permitted originals](pulse/measurements/pulse-originals.md): bounded cohort
  из 7 JPEG/PNG, actual playback/storage, exact hashes/sums, bounded staging,
  HTTP/decode/native/GPU samples. Не год наблюдений и не новый leak verdict.
- [Feather](pulse/measurements/pulse-p1.md#feather-начало-установленной-приёмки):
  штатное обновление `0.3.0-beta.4` → `0.4.0-beta.2`, playback/запись,
  enable/disable, полный выход/restart, переходы и диалоги, доступные размеры
  окна/fullscreen при Windows 125%, физический тачпад и player controls.
- [Installed identity](pulse/measurements/pulse-p1.md#feather-идентичность-установленного-артефакта):
  EXE/app.asar hashes и build `4058653` сняты с установленного приложения.
- [Installed error/fallback](pulse/measurements/pulse-p1.md#feather-installed-errorfallback--pass):
  отдельный disposable profile, synthetic history, API 503/retry,
  missing/corrupt cover и восстановление исправного изображения.
  Не физическое повреждение файлов и не actual recorder cohort.
- [Beta release](https://github.com/grouzdev/harbor-player/releases/tag/v0.4.0-beta.2):
  локальный gate, PR CI и release workflow PASS на `4058653`, установщик
  скачан и проверен по SHA-256/SHA-512/размеру.

## Что перенесено

Единственный список остаточных работ — [бэклог](backlog.md):
process timeout, Edge startup/cold хвост, инъекция silent worker exit,
keyboard/focus, темы/accent, недоступные устройства, оставшиеся ручные
сценарии и будущие расширения. Эти риски приняты для первого этапа;
технические NOT RUN/INCONCLUSIVE в старых отчётах не переписаны в PASS.

## Интеграция

Пользователь разрешил merge текущей ветки в `main`. Изменения после
release source — документация и standalone installed-error harness;
продуктовый код установленной beta.2 не менялся.
Перед merge проверить diff/format/lint и CI ветки, после merge —
результат CI окончательного SHA в `main`. Старый release CI не заменяет
этот integration gate. Новая публикация или stable-релиз не требуются.

## Правила дальнейшей работы

- Не начинать новый полный круг memory/sleep/ingest/UI cohorts без
  релевантной правки или воспроизводимого дефекта.
- Для повтора originals использовать существующий permitted manifest
  `scripts/pulse-artwork-fixture.mjs` и
  [методику playback/storage](pulse/playback-storage.md). Private originals,
  абсолютные пути и raw traces не коммитить и не публиковать.
- Рабочий профиль VLVY не трогать. Искусственные ошибки/clear — только
  на разрешённых тестовых данных. Не менять часы или power settings.
- Legacy `server.lock` не удалять автоматически: только отдельно
  согласованная offline migration при остановленных старых экземплярах.
- Журналы фактов сохранять в `docs/pulse/measurements/`, включать новые
  измерения в [индекс](pulse/measurements/README.md). Не создавать второй
  план завершения; открытые задачи складывать в бэклог.
