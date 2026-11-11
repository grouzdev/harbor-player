# Карта проверок

## Что запускается автоматически

| Событие | Проверки |
| --- | --- |
| Любой PR, push в `main` или `fix/ci-*` | Windows: fixtures → format → lint → verify:tags → npm test → build (включая typecheck) → полный Chrome → полный Edge → Electron pack → packaged smoke |
| Push тега `v…-beta.…` | Проверка версии → fixtures → verify:tags → npm test → build → полный Chrome → полный Edge → сборка beta installer/portable → smoke unpacked и portable → проверка файлов → публикация → проверка опубликованного релиза |
| Другой тег `v*` | Stable workflow: основные проверки, затем подпись unpacked и дистрибутивов, проверка подписей, smoke подписанных unpacked/portable, проверка и публикация файлов. Нужна настроенная подпись |
| Изменения `website/**` или workflow сайта в PR/main | Отдельный Linux workflow сайта: check, build, тесты сайта; из main также deploy |
| Push в другую ветку без PR | Автоматического запуска Windows CI нет |

Источники: [ci.yml](../.github/workflows/ci.yml),
[release.yml](../.github/workflows/release.yml), [website.yml](../.github/workflows/website.yml).
Windows CI не фильтруется по путям: PR только с документацией или сайтом тоже
запускает полный набор приложения. CI и release независимы: отправка main и тега
на один SHA запускает два набора. Повторный запуск релиза не использует приёмку
из CI. Это пока сохранённое поведение, не оптимизация, выполненная этим изменением.

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
| `npm run test:e2e:smoke` | Быстрая узкая проверка Tab-навигации и fullscreen в Chrome и Edge, со сборкой. Не проверяет основные файловые операции и не заменяет полный набор |
| `npm run test:e2e` | Сборка с typecheck и весь браузерный набор последовательно в Chrome и Edge, без retries |
| `npm run desktop:pack` → `npm run test:desktop:smoke` | Сборка unpacked Electron, проверка fuse, запуска backend, сканирования, HTTP Range и записи тегов |
| `npm run desktop:dist` → оба `test:desktop:smoke` / `test:desktop:smoke:portable` | Сборка unsigned beta installer/portable и smoke unpacked/portable |

Packaged smoke не открывает обычное пользовательское окно и не проверяет звук
из Electron renderer. Наличие NSIS-файла не означает проверенную установку
поверх предыдущей версии.

### Повторное использование сборки

Обычные команды выше самостоятельно собирают исходники. Для CI есть варианты
`test:e2e:built`, `desktop:pack:built`, `desktop:dist:built`: они используют уже
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

## Что пока не разделено

Отдельного полноценного «быстрого набора» пока нет: существующий browser smoke
слишком узок. Полный набор сохранён, включая проход клавиатурой всех 1000 рангов
Пульса и миграцию v12. Выбор тестов для быстрого/расширенного набора — следующий
шаг, а не скрытое сокращение проверок.

Замеры и основания первого устранения повторов:
[разбор CI](../.forma/test-pipeline-review.md).
