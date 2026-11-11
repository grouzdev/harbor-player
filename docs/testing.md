# Карта проверок

## Что запускается автоматически

| Событие | Проверки |
| --- | --- |
| Любой PR, push в `main` или `fix/ci-*` | Windows: выбор fast/full по изменённым путям → fixtures → format → lint → verify:tags → соответствующие unit-тесты → build (включая typecheck) → соответствующий E2E. Только full: Electron pack и packaged smoke |
| Ручной Windows CI (`workflow_dispatch`) | Выбор fast/full, по умолчанию full. На теге всегда full |
| Push тега `v…-beta.…` | Проверка версии → fixtures → verify:tags → npm test → build → полный Chrome → полный Edge → сборка beta installer/portable → smoke unpacked и portable → проверка файлов → публикация → проверка опубликованного релиза |
| Другой тег `v*` | Stable workflow: основные проверки, затем подпись unpacked и дистрибутивов, проверка подписей, smoke подписанных unpacked/portable, проверка и публикация файлов. Нужна настроенная подпись |
| Изменения `website/**` или workflow сайта в PR/main | Отдельный Linux workflow сайта: check, build, тесты сайта; из main также deploy |
| Push в другую ветку без PR | Автоматического запуска Windows CI нет |

Источники: [ci.yml](../.github/workflows/ci.yml),
[release.yml](../.github/workflows/release.yml), [website.yml](../.github/workflows/website.yml).
Windows CI не пропускает события по путям: PR только с документацией или сайтом
тоже запускает проверки приложения, но в fast-режиме. CI и release независимы: отправка main и тега
на один SHA запускает два набора. Повторный запуск релиза не использует приёмку
из CI. Это пока сохранённое поведение.

## Быстрый и полный наборы

```powershell
npm run check:fast
npm run check:full
```

Обе команды включают fixtures, format, lint, verify:tags и одну полную сборку
с typecheck. Быстрый запускает Vitest без исторической миграции v12 и Chrome
без `@full`; полный — весь Vitest, весь Chrome и Edge, затем Electron pack/smoke.
Полный набор включает быстрый. Обычные `npm test` и `npm run test:e2e`
по-прежнему означают все тесты соответствующего слоя, а не быстрый режим.

### Что исключено из fast и зачем

| Только full | Причина и оставшаяся быстрая защита |
| --- | --- |
| `tests/pulse-migration.test.ts` | Совместимость с исторической v12; текущие тесты БД и операций сохраняются |
| Edge целиком | Полная браузерная матрица; те же быстрые сценарии выполняются в Chrome |
| `@full` в `pulse.spec.ts` | Все 1000 рангов и расширенная геометрия. В fast остаются переход через границу страницы, Home/End, возвращение фокуса, cached-rank regression и реальное воспроизведение |
| `@full` в `pulse-time-browser.spec.ts`, `pulse-reliability.spec.ts` | Повторы, freeze/background, media error, длительный offline/re-enable. В fast остаются реальное аудио 1×, перенос проигрываемого файла, outbox, ACK/retry и storage-регрессии |
| `@full` в `appearance`, `catalog-filters`, `library`, `panel-transitions`, `workspace-surface`, `player-value-bubble` | Расширенные матрицы фонов, размеров, анимаций и косметики. В fast остаются основные действия, обычное/компактное окно, hit area слайдеров, divider drag/keyboard и сохранение настроек |
| Electron pack/smoke | Поставка и native-окружение; в fast приложение собирается, но упаковка не проверяется |

Теги находятся прямо в названиях тестов; fast использует `--grep-invert @full`.
Полный запуск не использует grep-исключений. Новый тест без тега автоматически
попадает в fast, поэтому случайно потерять его в ручном списке нельзя.

Старые варианты светлой темы и E2E на 0.5×/2× удалены, не перенесены в full.
Светлая тема запланирована отдельно: её CSS здесь не удалялся, новые проверки
появятся вместе с принятой реализацией. Точный RGB/градиент разделителей больше
не является gate.

### Выбор режима в CI

Правило находится в `scripts/select-test-mode.mjs`, регрессии —
`tests/test-mode.test.ts`. Fast разрешён только для известных presentation-файлов,
клиентских CSS, документации и сайта. Изменения backend/БД/файловых операций,
shared-контрактов, desktop, playback/Пульса/сессии, зависимостей, тестов и
инфраструктуры всегда выбирают full. Новые неизвестные пути тоже выбирают full;
это консервативный allowlist, не анализ транзитивных зависимостей.

Для push сравнивается весь диапазон `before → sha`; для PR — merge-base base/head
с head PR. Rename detection отключён: учитываются и удалённый, и новый путь.
Пустой diff, новая ветка с нулевым before, недоступная история или ошибка Git
означают full. Результат и причина видны в step summary GitHub Actions.
В workflow всё, что не равно `fast`, проходит полные проверки.
Релизный workflow не использует этот выбор и всегда выполняет полную приёмку.

## Локальный запуск

Node 24, `npm ci`, установленные Chrome и Edge. Перед файловыми проверками:

```powershell
npm run fixtures
npm run verify:tags
```

`verify:tags` не просто тест: создаёт `verification/tag-support.json`, который
определяет доступные форматы записи и включается в дистрибутив. Выполнять до
сборки проверяемого приложения. Отчёт может изменить рабочее дерево; не коммитить
его автоматически только из-за новой даты.

| Команда | Что гарантирует |
| --- | --- |
| `npm run format:check`, `npm run lint`, `npm run typecheck` | Стиль, статические проверки и типы; не проверяют поведение приложения |
| `npm test` | Весь Vitest: логика, API/SQLite/файлы, процессы, миграция исторической БД. Вложенный Node test runner также запускает настоящий Chrome для проверки диагностики |
| `npm run test:unit:fast` | Тот же Vitest без исторической миграции v12 |
| `npm run test:e2e:smoke` | Быстрая узкая проверка Tab-навигации и fullscreen в Chrome и Edge, со сборкой. Не проверяет основные файловые операции и не заменяет полный набор |
| `npm run test:e2e` | Сборка с typecheck и весь браузерный набор последовательно в Chrome и Edge, без retries |
| `npm run test:e2e:fast` | Сборка с typecheck и Chrome без `@full` |
| `npm run desktop:pack` → `npm run test:desktop:smoke` | Сборка unpacked Electron, проверка fuse, запуска backend, сканирования, HTTP Range и записи тегов |
| `npm run desktop:dist` → оба `test:desktop:smoke` / `test:desktop:smoke:portable` | Сборка unsigned beta installer/portable и smoke unpacked/portable |

Packaged smoke не открывает обычное пользовательское окно и не проверяет звук
из Electron renderer. Наличие NSIS-файла не означает проверенную установку
поверх предыдущей версии.

### Повторное использование сборки

Обычные команды выше самостоятельно собирают исходники. Для CI есть варианты
`test:e2e:built`, `test:e2e:fast:built`, `desktop:pack:built`, `desktop:dist:built`: они используют уже
готовый `dist`, не выполняя повторный build/typecheck. Последние две команды
готовят Electron и выполняют упаковку, но не компилируют исходники.

Пример полного локального набора с одной полной сборкой:

```powershell
npm run fixtures
npm run format:check
npm run lint
npm run verify:tags
npm test
npm run build
npm run test:e2e:built
npm run desktop:pack:built
npm run test:desktop:smoke
```

После изменения исходников, версии, зависимостей или отчёта записи тегов
нужно снова выполнить build перед `:built`. Сначала браузерные тесты, затем
упаковка Electron: упаковщик может перестроить native-зависимости под Electron.
Браузеры используют общий backend и рабочую сессию, поэтому увеличение
`workers` без изоляции данных небезопасно.

## Отдельные проверки, не входящие в CI/release

- `test:session:desktop`: восстановление рабочей сессии в Electron.
- `test:pulse:process`, `test:pulse:publication`, `test:pulse:desktop`:
  специальные отказные и crash/restart сценарии.
- `test:pulse:memory`, `test:pulse:ui`, `benchmark*`: измерения памяти,
  отзывчивости и производительности, не обычный релизный gate.
- `test:pulse:sleep`: физические sleep/wake выполняет человек; команда сама
  не отправляет компьютер в сон. Короткий smoke не доказывает работу sleep/wake.
- `verify:pulse:migration -- <путь>`: отдельная проверка предоставленной старой
  БД через временную копию. Не путать с автоматическим синтетическим migration-тестом.

## Границы приёмки

`check:full` не строит NSIS/portable: это полный разработческий gate, как Windows
CI. Проверка готовых дистрибутивов дополнительно выполняется при релизе.
Существующий browser smoke остаётся узкой диагностической командой, а не
заменой fast. Remote-время новых наборов нужно измерять после запуска workflow;
локальные длительности не являются обещанием ускорения GitHub runner.

Локальная приёмка разделения на Windows / Node 24.20.0:

| Команда | Состав | Время |
| --- | --- | --- |
| `check:fast` | 632 Vitest + 154 Chrome | 6:56 |
| `check:full` | 635 Vitest + 184 Chrome + 184 Edge + pack/smoke | 16:15 |

Разница Vitest — три исторических v12-теста; E2E — 30 `@full` сценариев
на браузер и отсутствие Edge в fast. Измерения относятся к состоянию задачи
разделения, не являются бюджетом для будущих тестов.

Замеры и основания первого устранения повторов:
[разбор CI](test-pipeline-review.md).
Результаты разделения: [задача](test-suites.md).
