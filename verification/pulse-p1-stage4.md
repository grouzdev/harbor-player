# Пульс P1: автономные доработки и восстановленный e2e gate

База `675ec678ff348e80506f826141434d11f0929ec5`, ветка
`wip/pulse-p1-followup`, измерены dirty-артефакты. Продолжение
[третьего этапа](pulse-p1-stage3.md). Merge/push/установка/релиз не выполнялись.

## Результат по обязательствам

| Пункт                                                  | Результат                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Два падения общих library-сценариев Edge               | Закрыты: исправлено подменю, изолирована фикстура, полный e2e 141+141              |
| Partial publication при kill-during-copy/restart       | Проверена безопасность: нет раннего ACK/commit или неполного archive, retry точный |
| Автоматическое восстановление/cleanup staging          | Не закрыто: orphan остаётся, нужен безопасный stale-lock takeover                  |
| Generated artwork decode и immutable content integrity | Проверены PNG/JPEG/truncation и SHA-256 всех 855 публикаций                        |
| Подготовка installed/manual checklist                  | Выполнена; сами ручные результаты NOT RUN                                          |
| Новый CI на финальном SHA                              | Не выполнялся; существующие результаты только прочитаны                            |

## Причина e2e-падений и исправление

Сохранённый Edge trace показывал: root context menu остаётся, а открытое
подменю удаляется перед click. Второй library-тест затем получает API 409:
предыдущий тест не дошёл до отключения общей `file-operations/Downloads`.

Причина воспроизведена отдельной регрессией: открыть подменю, сохранить handle
конкретного пункта, изменить настоящую громкость плеера и дождаться двух RAF.
На прежней реализации `item.isConnected=false`. Повторная инициализация
`ContextMenu` зависела от `onClose`, который родитель передаёт новой функцией
при render. Инициализация теперь зависит только от нового `menu`; dismissal
listeners по-прежнему обновляются с актуальным `onClose`. Незавершённый initial
focus RAF отменяется при смене/закрытии menu.

Для root-menu сценария создан собственный `root-menu/Downloads`, не общий
источник большого file-operations теста. Skip, дополнительные retries,
повышение timeout и изменение правил каталога не использовались.
Гипотеза о hover-gap не выдаётся за установленную причину и отдельным фиксом
не подменяла подтверждённую render-регрессию.

## Artwork: что именно проверено

- Реальный browser decode generated wide PNG 1024×64 и portrait JPEG 64×1024;
  truncated PNG не декодируется, но название, selection и статистика остаются.
  Основной ingest/API путь реальный; image HTTP управляется route fixture.
  Это browser decode, не только результат Sharp, но и не пользовательские originals.
- Новый `verifyArtworkManifest` сопоставляет точные IDs, индивидуальные bytes
  и content SHA-256 с manifest, а не только aggregate count/bytes.
- Same-size corruption, подмена ID, duplicate flat/archive и archive-shaped
  symlink/junction отклоняются тестами. Published image также должен быть
  обычным файлом, не symlink.
- `npm run benchmark:pulse:ingest`:
  `.test-data/pulse-p1-ingest-joUNTT/result.json`, exit 0.
  **855 images / 8 790 222 bytes**, каждый SHA-256 проверен, staging **0**.
  Все четыре суммы **260 386 000 мс**; overlapping read p95 **34,558 мс**
  (2513 requests), baseline **29,177 мс**. Это generated 30-дневная модель,
  не новое actual audio или год наблюдений.

## Реальный kill-during-copy и граница recovery

Новая точная команда:

```sh
npm run test:pulse:publication
```

`.test-data/pulse-publication-crash-RzgZAD/evidence.json`, **PASS**.
Child выполняет настоящую chunked filesystem copy с production publication
и transaction code, записывает/fsync первые **65 536 bytes** из **1 048 576**,
после чего parent завершает его `SIGKILL` с открытыми handles.
Это управляемый copy adapter, не случайный момент внутри штатного `copyFile`;
процесс действительно убит, исключение вместо crash не симулируется.

Restart идёт через `MusicService` и существующий instance-lock lifecycle.
До retry нет listening commit; до kill нет ACK или опубликованного archive.
После retry архив полный, его hash равен source hash; повтор батча сохраняет
ровно **15 000 мс**. Flat/archive и foreign/ambiguous canaries не изменены.
Production server/shared source не менялся. Дополнены bounded transient
publication-error и paused partial-copy unit tests.

**Recovery не реализован и не принят.** Частичный staging остаётся.
Существующий `acquireInstanceLock` при мёртвом PID делает отдельные read/check
и unlink. Два рестартера могут прочитать прежний PID, после чего один удалит
уже новую блокировку другого. Это обнаруженная по коду гонка, не результат
отдельного concurrent-takeover прогона. Такой протокол не даёт достаточного
основания автоматически удалять staging как эксклюзивному владельцу.

Следующий безопасный порядок: отдельно исправить/проверить takeover владения
data dir, затем добавлять консервативный owned-staging recovery. Ни broad GC,
ни удаление опубликованных ресурсов сейчас не добавлены. Crash storage
приёмка остаётся открытой именно в части orphan recovery/накопления.

Artifact содержит Git SHA/dirty, hashes check/worker, Pulse/service/instance-lock
source и compiled artifacts, Node executable hash, source/archive hashes.

## Проверки после последнего изменения исходников

Логи `.test-data/pulse-p1-stage4-final-daCoWb/`.

| Команда                          | Результат                                                       |
| -------------------------------- | --------------------------------------------------------------- |
| `npm test`                       | PASS: 51 файл, 425 тестов                                       |
| `npm run build`                  | PASS, включая typecheck                                         |
| `npm run lint`                   | PASS                                                            |
| `npm run format:check`           | PASS                                                            |
| `npm run test:e2e`               | PASS: непрерванная общая команда, Chrome 141/141 + Edge 141/141 |
| `npm run test:pulse:publication` | PASS, real kill/restart                                         |
| `npm run benchmark:pulse:ingest` | PASS, включая per-image integrity gate                          |
| `git diff --check`               | PASS                                                            |

Предыдущие FAIL и результаты третьего этапа не переписываются.
Полные memory/navigation cohorts не повторялись: Pulse layout/cache/lifetime
не менялись; закрытые результаты относятся к артефактам в предыдущем журнале.
Process/desktop/sleep cohorts не повторялись: production ingest, recorder,
delivery, lifecycle и sleep-учёт не менялись. Installed/manual остаётся отдельным.

## CI и оставшиеся внешние шаги

CI прочитан через `gh`, без rerun/push. Последний существующий Windows CI:
[`690afd0`, failure](https://github.com/grouzdev/harbor-player/actions/runs/38757717330).
Падает старый `tests/album-header.test.ts` на ожидании `track-album-actions`;
browser и packaged шаги были skipped. Это другая версия исходников:
локальный текущий suite проходит, но нового CI результата отсюда не следует.
Последний найденный success — `0fcb964`.
Локальный лог: `.test-data/pulse-p1-stage4-final-daCoWb/ci-690afd0-failed.log`.

Единый [installed/manual checklist](pulse-p1.md#ручная-приёмка-установленного-приложения)
дополнен полями идентичности установленной сборки, окружения и недостающими
сценариями. Автоматические результаты не проставлялись как manual PASS.

Остаются permitted originals, installed/manual и physical input/FAT,
исторический Edge startup хвост, CI на финальном SHA, согласованная интеграция
с `main`, а также безопасный staging recovery после решения ownership.
Сводный release/P1 gate не закрыт.
