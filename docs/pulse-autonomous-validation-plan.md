# Пульс: следующий автономный блок — измерения и gate

Продолжение [шестого этапа](../verification/pulse-p1-stage6.md).
Код A/B/C реализован; следующий результат должен закрыть приёмку,
а не начинать очередную необоснованную переработку.
Участие оператора не требуется; рабочие данные/lock/profile не использовать.

## 1. Проверить итоговую сборку и smoke

```sh
npm run desktop:pack
npm run test:pulse:ui -- --smoke --mutations-only --electron
```

Сохранить source SHA/dirty, executable/app.asar hashes, окружение и raw evidence.
Если ошибка — разбирать точную причину, не повышать timeout и не ослаблять
readiness/generation assertions. Проверить неизменность artifact между launches.

## 2. Выполнить полный mutation cohort без параллельной нагрузки агента

```sh
npm run test:pulse:ui -- --mutations-only --electron
```

Никаких одновременных build/e2e/benchmark workers. Preflight должен пройти
без отключения free-space/retained-copy ограничений.
Ожидаются 30 независимых fixtures для ordinary и 30 для ten-year;
по 30 samples listening/clear/recovery на каждом dataset.
Убедиться, что каждая группа имеет полный count и валидные mutation proofs,
native foreground, bounded pages и согласованные hashes.

Записать median/p95/max dataReady и coversReady, сравнить warm guide <100 мс.
После clear состояние пустое, recovery одноальбомный: не обозначать их
как измерение десятилетней наполненной истории.
Generated artwork не закрывает originals, GPU или installed/manual.
При превышении guide исследовать измеренное узкое место отдельно от samples;
не удалять slow samples и не повышать бюджет.

## 3. Независимое ревью исправлений по замечаниям

Подтвердить app.asar provenance и SQLite cancellation/unref regression.
Проверить final helper/fixture budget propagation и честность p95 claims.
Не повторять уже одобренный lifecycle рефакторинг без новой причины.

## 4. Итоговые локальные проверки

```sh
npm run fixtures
npm run verify:tags
npm test
npm run build
npm run lint
npm run format:check
npm run test:e2e
npm run test:pulse:publication
npm run test:pulse:process
npm run test:pulse:desktop
git diff --check
```

Full e2e — обе project-команды, без фильтров/skip и изменения test timeout.
Внешний terminal allowance должен вмещать весь прогон (не менее 20 минут).
Generated prerequisites обязательны и в isolated worktree.
Process/desktop повтор нужен после последней правки diagnostics cancellation.
Ingest повторять только при новом релевантном production изменении:
результат шестого этапа уже записан.

Результаты добавить в журнал шестого этапа, обновить сводную финализацию
по evidence. До полного выполнения не заявлять новый зелёный gate.

## После автономного блока всё ещё нужен человек

- Разрешённые реальные JPEG/PNG и manifest для actual artwork/storage.
- Согласованная установка и заполнение manual checklist, реальные устройства
  ввода; physical FAT/exFAT при доступности.
- Offline migration рабочего legacy server.lock, если нужна.
- Разрешение интеграции/push и CI на окончательном SHA; отдельное решение о релизе.
- Решение о принятии остаточного риска по невоспроизведённым историческим
  process/Edge отказам. Автоматический PASS не заменяет такое решение.

Ни push, ни установка, ни миграция пользовательской блокировки в этот план
не входят. P2/retention/новые features не добавлять.
