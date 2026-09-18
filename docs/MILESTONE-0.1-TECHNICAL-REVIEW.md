# Технический аудит milestone 0.1

Дата среза: 18 сентября 2026 года.

## Статус закрытия milestone 0.1

**Закрыт 18 сентября 2026 года.** В P0 выполнено:

- `Escape` в `ArtworkViewer` перехватывается модальной границей и закрывает только viewer; браузерный сценарий подтверждает, что режим обложки остаётся открытым.
- Stateful Playwright-сценарии получили раздельные наборы `Downloads`/`Collection`/`Tree` для каждого браузера и сценария. Устаревшие ожидания в позднем файловом сценарии заменены фактическими контрактами UI, а подтверждение destructive-операций выполняется явными кнопками.
- Benchmark использует `folders`, заполняет `track_album_artists`, проверяет 100 000 треков, 10 000 альбомов и 1 000 треков выбранной папки. Обычный запуск пишет временный отчёт, а `npm run benchmark:baseline` явно обновляет `verification/catalog-benchmark.json`.
- README и roadmap синхронизированы с готовыми NSIS/portable, beta updater и release workflow; clean-VM и первый подписанный stable всё ещё честно отмечены как непроверенные.

Проверки закрытия: `npm run typecheck`, `npm run build`, `npm test` (108), `npm run verify:tags` (7 форматов), полный Playwright — 18/18 в Chrome и 18/18 в Edge. Новый 100k baseline: tracks 2493 ms, albums 2782 ms, genres 121 ms, queue snapshot 2450 ms, folders 118/82 ms, folder tracks 55 ms.

P1 закрыт 18 сентября 2026 года. В первом самостоятельном этапе были разделены error semantics, устранён N+1 при выдаче треков и сделан явным лимит очереди в 100 000 треков. Во втором — измерены тяжёлые facets, устранён найденный bottleneck `facetRelevance`, добавлена безопасная очистка SQLite-истории и CI quality gate. Проверки закрытия P1: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (112), `npm run build`, `npm run verify:tags` (7 форматов), Playwright smoke 4/4 и полный Playwright 18/18 в Chrome и 18/18 в Edge — пройдены.

P2.1–P2.2 закрыты 18 сентября 2026 года без изменения поведения: из `App` вынесены hooks геометрии shell и целевой прокрутки каталога, bookmark control, virtual catalog views и library/genre panels; library, cover-confirmation и tag/operation dialogs получили feature-границы с compatibility exports. `styles.css` стал manifest-entrypoint, а сохранённый cascade перенесён в `styles/base.css`; appearance остаётся отдельным stylesheet. Проверки срезов: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, focused Playwright в Chrome и Edge. Следующий этап — P2.3–P2.4: server orchestration и внутренние типы.

Первый срез P2.3–P2.4 выполнен 18 сентября 2026 года без изменения HTTP URL, UI и последовательности безопасных файловых операций. `Catalog.db` стал private: `MusicService`, HTTP app и MusicBrainz используют узкие repository-методы для scan state, очереди, доступности библиотек и HTTP-cache. Миграции схемы v1–v6 вынесены в именованный `catalog-migrations` runner. Worker protocol теперь различает `read` и `hash` на уровне request/response-типов, а SSE события имеют discriminated union. Jobs и operations из SQLite проверяются Zod при чтении; повреждённые записи не исполняются. Проверки: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (114), `npm run build`, `npm run verify:tags` (7 форматов), Playwright smoke 4/4 в Chrome и Edge. Полная нарезка scan/operations/recovery orchestration остаётся следующим малым P2-срезом.

Второй срез P2.3 выполнен 18 сентября 2026 года: `LibraryScanner` получил проверку доступности библиотек и полный scan-flow — incremental/force metadata read, worker fallback, исключение symbolic links, ограниченный параллелизм, ошибки обхода и финализацию scan state. `MusicService` сохранил последовательную job queue, cancellation при shutdown и текущий HTTP/SSE контракт, передавая scanner только callback публикации прогресса. Проверки: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (114), `npm run build`, `npm run verify:tags` (7 форматов), Playwright smoke 4/4 в Chrome и Edge. Следующий безопасный срез — preview/execute/recovery файловых операций.

Второй срез P2.1 выполнен 18 сентября 2026 года: виртуализированные views артистов, альбомов и треков перенесены в `CatalogVirtualViews`; `App` сохранил ownership данных, фильтров, selection, pagination, player actions, context menus и drag-and-drop через явные props. Проверки: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (112), `npm run build`, полный Playwright 18/18 в Chrome и 18/18 в Edge. Library и genre panels остаются последней частью panel-slice.

## Краткий вывод

Harbor Player уже выглядит как законченный первый milestone, а не как прототип. Основной пользовательский поток — подключение локальной коллекции, фильтрация, воспроизведение, перенос и удаление с восстановлением, пакетная запись тегов, обложки, MusicBrainz и Windows desktop shell — опирается на осмысленные проверки сохранности и достаточно широкую тестовую базу.

Критических дефектов, которые указывали бы на риск немедленной потери музыки, во время этого аудита не обнаружено. TypeScript-проверка, production build, 108 unit/integration-тестов и аудит production-зависимостей проходят. Перед фиксацией `0.1` стоит закрыть не новые функции, а качество доказательств: сделать браузерные тесты изолированными, починить benchmark, устранить один найденный дефект с `Escape` и синхронизировать документацию.

После этого разумно перейти к постепенной декомпозиции самых крупных модулей. Полная переработка архитектуры сейчас не нужна: код уже разделяет client/server/shared/desktop, а наиболее рискованные файловые операции имеют самостоятельные защитные механизмы.

## Что проверено

| Проверка                   | Результат                                   |
| -------------------------- | ------------------------------------------- |
| `npm run typecheck`        | Пройдено                                    |
| `npm test`                 | 16 файлов, 108 тестов — пройдено            |
| `npm run build`            | Пройдено                                    |
| `npm audit --omit=dev`     | 0 известных уязвимостей                     |
| `npx prettier --check ...` | Не пройдено: 21 файл отличается от Prettier |
| Полный Playwright, Chrome  | 15 из 18 тестов пройдено                    |
| Полный Playwright, Edge    | 15 из 18 тестов пройдено                    |

Браузерные результаты требуют пояснения:

- полный набор использует один каталог данных на весь запуск (`scripts/e2e-server.mjs:73-110`), а разные тесты повторно подключают одни и те же папки, например `Downloads` (`tests/browser/library.spec.ts:630`, `745`, `1892`, `2189`);
- поэтому поздние сценарии получают ошибку «Эта папка или её родитель уже подключены», а последнее падение становится каскадным;
- тест выделения панелей отдельно проходит и в Chrome, и в Edge;
- большой файловый сценарий отдельно в обоих браузерах доходит до поздней проверки тени обложки. Цвет фактически верный, но проверка ожидает `rgb(...)`, тогда как браузер возвращает `rgba(...)` (`tests/browser/library.spec.ts:1620`);
- сценарий режима обложки отдельно выявляет настоящий дефект: после закрытия полноэкранного просмотрщика клавишей `Escape` закрывается также сам режим обложки. У `CoverMode` и `ArtworkViewer` одновременно есть обработчики `Escape` (`src/client/CoverMode.tsx:65-70`, `193-220`), причём оконный обработчик просмотрщика не предотвращает обработку того же события родителем.

Текущий `npm run benchmark` намеренно не использовался как доказательство производительности. Его сценарий передаёт устаревшее поле `folder` (`scripts/benchmark.mjs:80`), тогда как актуальный контракт использует массив `folders`. Кроме того, синтетические данные заполняют `track_artists`, но не `track_album_artists`, на котором теперь основана сортировка каталога. Скрипт также перезаписывает отслеживаемый файл `verification/catalog-benchmark.json`, поэтому сначала нужно восстановить корректность самого измерения.

## Что уже сделано хорошо

### Сохранность файлов

- Запись тегов изолирована от основного процесса, а разрешение записи зависит от отчёта проверки конкретной версии writer-библиотеки.
- Переносы и изменение тегов используют staging, fingerprint, резервные копии, flush и проверку состояния исходника между этапами.
- Символические ссылки не обходятся при сканировании, а пути повторно проверяются перед чтением и изменением.
- Прерванные jobs и operations переводятся в явное состояние восстановления при следующем запуске.

Эти свойства важнее косметической чистоты архитектуры. При рефакторинге `MusicService` их следует сначала зафиксировать характеристическими тестами, а не переносить логику большими блоками.

### Локальная безопасность

- Сервер слушает только `127.0.0.1`, проверяет `Host`, `Origin`, `Sec-Fetch-Site`, локальную cookie-сессию и CSRF для мутаций (`src/server/app.ts:66-140`).
- Electron запускается с `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, ограничивает навигацию и проверяет отправителей IPC (`src/desktop/main.ts:293-314`, `462-515`).
- Для файлов и Проводника применяются отдельные проверки принадлежности библиотеке.

Текущий локальный API нельзя просто открыть в домашнюю сеть: для этого по-прежнему нужны отдельные аутентификация, роли и модель угроз.

### Практичная тестовая база

108 unit/integration-тестов покрывают каталог, файловые операции, форматы тегов, обложки, MusicBrainz, фильтры и layout-утилиты. Playwright проверяет не только happy path, но и клавиатуру, responsive layout, полноэкранный режим, восстановление, перетаскивание обложек и групповое выделение. Проблема сейчас не в отсутствии сценариев, а в их общей изменяемой fixture.

## Приоритет 0: закрыть перед фиксацией milestone

### 1. [x] Исправить двойное закрытие по `Escape` — реализовано

**Реализовано.** `ArtworkViewer` перехватывает `Escape` в capture-фазе, отменяет распространение и закрывает только viewer. E2E подтверждает: viewer закрыт, режим обложки остаётся открыт.

Исходная причина сохранена для истории: оконный обработчик viewer не предотвращал обработку того же события `CoverMode`.

### 2. [x] Изолировать stateful Playwright-сценарии — реализовано

**Реализовано.** E2E server создаёт отдельные `Downloads`/`Collection`/`Tree` для каждого браузера и stateful-сценария: player, file operations, cover mode, folders и selection. Сценарии больше не повторно подключают или изменяют одинаковые пути.

Проверка тени использует фактический `rgba(...)`, destructive-операции подтверждаются явными кнопками. Полный запуск: Chrome 18/18, Edge 18/18.

### 3. [x] Восстановить валидный benchmark — реализовано

**Реализовано.** Benchmark использует `folders`, заполняет `track_album_artists` и до измерений проверяет totals: 100 000 треков, 10 000 альбомов и 1 000 треков в выбранной папке.

`npm run benchmark` пишет временный отчёт в `.test-data`; только `npm run benchmark:baseline` обновляет версионируемый baseline. Скрипт проверяется точечно через `@ts-check`; baseline снят заново и приведён в статусе выше.

### 4. [x] Синхронизировать документацию с фактическим релизным контуром — реализовано

**Реализовано.** README и roadmap отражают NSIS/portable, beta updater и release workflow; clean-VM и первый подписанный stable явно оставлены как непроверенные.

Исходное расхождение: README и roadmap относили уже реализованные installer/portable, updater и release pipeline к будущим шагам.

## Приоритет 1: сделать до следующего крупного функционального этапа

### 5. [x] Разделить ожидаемые ошибки API и внутренние сбои — реализовано

**Реализовано.** Добавлен небольшой тип `HttpError`: validation возвращает `400`, отсутствующий ресурс — `404`, конфликт или устаревшее состояние — `409`, остановка сервиса — `503`. Fastify-ошибки с заданным 4xx `statusCode` сохраняются. Неизвестные ошибки теперь возвращают `500` с нейтральным текстом, а полная ошибка передаётся локальному Fastify-логгеру.

Публичный формат `{ error }` сохранён. API-тесты отдельно подтверждают `404`, `409`, `500` без утечки внутреннего текста и `503` во время остановки.

### 6. [x] Убрать N+1 при загрузке треков — реализовано

**Реализовано.** `Catalog.tracks()` собирает форматы всех альбомов текущей страницы одним `SELECT DISTINCT ... WHERE albumKey IN (...)`, как и жанры альбома. Устранён худший случай с отдельным format-запросом на каждый из 200 треков страницы.

API-тест подтверждает форматы нескольких альбомов и единственную batch-выборку.

### 7. [x] Уточнить масштабные ограничения вместо тихого обрезания — реализовано

**Реализовано.** Новый ответ получения ID содержит `{ trackIds, total, truncated }`: первые 100 000 ID сохраняют прежний порядок, `total` сообщает полный размер результата, а `truncated` фиксирует усечение. Старое ограничение `selectionSchema` остаётся защитой от материализации более крупного выбора в клиенте.

Очередь возвращает свой фактический `total`, полный `sourceTotal` и `truncated`. При превышении лимита плеер сообщает, что добавлены первые 100 000 из полного количества; массовое выделение альбома показывает такое же предупреждение. API-тест покрывает ответ усечённой очереди.

### 8. [x] Измерить и оптимизировать тяжёлые facet-запросы — реализовано

**Реализовано.** Benchmark теперь выполняет пять тёплых замеров `artists`, `facetRelevance` и `filterValidity` на разнообразной синтетической базе 100 000 треков. Бюджет median — 500 мс. Новый baseline: artists 100 мс, facet relevance 24 мс, filter validity 253 мс.

Профиль выявил `facetRelevance` в 3316 мс: коррелированный `EXISTS` для выбранных артистов не использовал relation-индекс эффективно. Он заменён выборкой `trackId` через `track_album_artists`/`track_genres`; построение предков папок перенесено в рекурсивный SQLite CTE. Результат facets сохранён характеристическими tests. Новая schema, materialized relation и кэш не потребовались.

### 9. [x] Добавить политику обслуживания SQLite — реализовано

**Реализовано.** Истёкший `http_cache` удаляется при старте `Catalog` и при ручной очистке. В журнале операций появилась явная команда «Очистить завершённые»: она удаляет только успешно завершённые переносы и restore-операции вместе с их завершёнными jobs.

Операции с возможностью восстановления (`trash`/`tags`), прерванные, выполняющиеся и записи с ошибками не удаляются. Действие подтверждается пользователем; автоматического удаления recovery-данных и `VACUUM` нет. API `DELETE /api/operations/history` и API-тест подтверждают эту границу.

### 10. [x] Сделать CI явным quality gate — реализовано

**Реализовано.** Добавлены `format:check`, ESLint для TypeScript-синтаксиса и React Hooks (семантическую проверку TypeScript сохраняет `typecheck`) и `test:e2e:smoke`. PR CI запускает fixtures, format, lint, typecheck, tag verification, unit/integration, smoke в Chrome/Edge и desktop smoke. Push в `main` и оба release workflow дополнительно запускают полный Playwright в Chrome/Edge.

Короткий smoke проверяет keyboard dialog flow и fullscreen shell в обоих браузерах. Полный browser suite остаётся отдельным более долгим gate перед публикацией.

## Приоритет 2: плановый рефакторинг без изменения поведения

### 11. [x] Начать разделение клиентского `App` — реализовано

`src/client/App.tsx` содержит 3743 строки и одновременно управляет:

- локальным и серверным состоянием;
- fullscreen и собственной геометрией окна;
- пятью панелями и их resize;
- каталогом папок;
- bookmarks и context menus;
- SSE/jobs/operations;
- drag-and-drop обложек;
- навигацией из плеера;
- виртуализированными Artist/Album/Track views.

Это увеличивает радиус любой UI-правки и затрудняет проверку зависимостей эффектов. Рекомендуемая последовательность:

1. Вынести чистые panel views без изменения state ownership.
2. Вынести `useFullscreenWindow`, `useCatalogFilters`, `useOperationEvents`, `useBookmarks` с существующими контрактами.
3. Собрать actions/context menus около соответствующей feature, а не в корневом компоненте.
4. Только после этого решать, нужен ли reducer для связанного состояния.

Не следует начинать с глобального state manager: TanStack Query уже корректно владеет серверным состоянием, а основная проблема — смешение feature-логики в одном файле.

**Реализовано.** `useAppShellLayout` владеет наблюдением за размером shell, `useCatalogScrollTargets` — состоянием и запросами прокрутки каталога, а `BookmarkToggle` вынесен из корневого компонента. В `CatalogVirtualViews` перенесены virtualized Artist/Album/Track views, а в `LibraryGenrePanels` — library/genre panels с сохранением props, DOM и selection semantics. `App` по-прежнему владеет верхнеуровневым состоянием и передаёт существующие контракты без изменений. Дальнейшее выделение hooks/actions — плановый рефакторинг, а не условие перехода к P2.3.

### 12. [x] Начать разделение dialogs и CSS по feature-границам — реализовано

`Dialogs.tsx` содержит 1387 строк, `styles.css` — 3323. Это не дефект само по себе, но оба файла меняются почти при любой новой функции.

Разумное деление:

- library dialogs;
- file operation dialogs;
- tag/MusicBrainz dialogs;
- catalog panels;
- player/cover mode;
- shell/layout;
- общие tokens и primitives.

Необязательно переходить на CSS Modules. Достаточно feature-файлов с сохранением существующих классов и порядка подключения, чтобы не изменить cascade одним большим коммитом.

**Реализовано.** `AddLibraryDialog`, `RenameLibraryDialog` и `RemoveLibraryDialog` находятся в `LibraryDialogs`, подтверждение обложки — в `CoverDropConfirmDialog`, а tag/MusicBrainz и operation dialogs — в `TagOperationDialog`; `Dialogs` сохраняет compatibility re-exports. Общий Enter-flow вынесен в `dialog-keyboard`. `styles.css` стал manifest-entrypoint, подключающим fonts, appearance и сохранённый в `styles/base.css` source-order cascade; относительный путь к lounge-фону проверен production build. Дальнейшая детализация CSS по слоям — плановый рефакторинг без изменения поведения.

### 13. [x] Первый срез декомпозиции server orchestration — реализовано

`MusicService` (1186 строк), `Catalog` (903) и HTTP app (723) сейчас являются тремя широкими точками связности. При этом код уже имеет естественные границы:

- scanner и availability;
- job queue;
- operation preview/execution/recovery;
- catalog queries;
- migrations;
- queue/player endpoints;
- MusicBrainz.

В первую очередь стоит скрыть публичный `Catalog.db` (`src/server/database.ts:54`). Прямой SQL из app/service/MusicBrainz мешает менять схему и тестировать границы. Добавлять следует небольшие методы repository, а не новый универсальный data-access framework.

Миграции лучше вынести из конструктора `Catalog` в последовательные именованные шаги с отдельными тестами upgrade from N to N+1. Перед первой потенциально разрушительной миграцией добавить backup каталога и `integrity_check`.

**Реализовано в первом срезе.** Прямой доступ к `Catalog.db` закрыт за небольшими методами repository: availability, состояние scan, доступные треки библиотеки, queue persistence, album count и MusicBrainz cache. HTTP app, `MusicService` и `MusicBrainzService` больше не содержат SQL. Существующие миграции v1–v6 перенесены из конструктора в `catalog-migrations` как последовательные транзакционные шаги; характеристический upgrade v5 сохранён. Scan completion и обновление `lastScan` объединены в repository-транзакцию, не меняя условия пометки unavailable.

**Реализовано во втором срезе.** `LibraryScanner` владеет availability и обходом файлов библиотеки, включая incremental и force scan, fallback worker metadata read, безопасное исключение symbolic links, два параллельных файла, ограничение ошибок и различие полного/неполного traversal. `MusicService` сохраняет ownership единственной job queue, progress publication и controlled shutdown. Preview/execute/retry/recovery файловых операций намеренно остаются следующим срезом.

### 14. [x] Первый срез усиления внутренних границ — реализовано

Zod хорошо защищает входящий API, но ответы, JSON из SQLite, SSE events, сообщения workers и MusicBrainz payload местами приводятся через `any` или ручной cast. Полезный порядок:

1. Типизировать worker request/response вместо `resolve(value: any)`.
2. Добавить схемы для persisted jobs/operations и проверять их при чтении старой базы.
3. Описать discriminated union для SSE events.
4. Свести route schemas и клиентские response types к общим контрактам без генерации сложного SDK.

Это особенно важно перед будущими миграциями и сетевым режимом, но не требует менять HTTP URLs в milestone 0.1.

**Реализовано в первом срезе.** `read` и `hash` worker tasks имеют явные аргументы и результаты вместо `string`/`unknown`/`any`; отдельный тест подтверждает hash round-trip через worker. События catalog, job, operation-start и operation-finished описаны discriminated union и передаются в SSE через typed API сервиса. Persisted `jobs` и `operations` валидируются Zod при чтении; malformed JSON и некорректная структура исключаются из списков, а точечное чтение операции завершается безопасной ошибкой без исполнения. В следующем срезе остаются общие route/client response contracts и более широкая типизация MusicBrainz payload.

## Приоритет 3: оптимизации после измерений

### Сканирование

Сейчас каждые пять минут выполняется полный обход всех папок, хотя теги неизменившихся файлов не читаются повторно. Для очень больших или сетевых дисков дорогим останется сам traversal. Возможные будущие улучшения: разная частота для активных/недоступных библиотек, debounce ручного сканирования, watcher только как подсказка к scan, а не как источник истины.

File watcher не должен заменять периодическую сверку: Windows notifications могут теряться, а внешние диски и сетевые папки ведут себя неодинаково.

### Размер клиентской сборки

Production build создаёт один JS bundle около 494 КБ (147 КБ gzip) и фоновое изображение около 805 КБ. Это приемлемо для локального desktop-приложения, но bundle уже близок к стандартному предупреждению Vite. Перед code splitting нужно измерить cold start. Наиболее естественные кандидаты для lazy loading — большие dialogs, настройки и MusicBrainz workflow; основные панели и player лучше оставить в стартовом bundle.

### Наблюдаемость

Для локального приложения не нужен внешний telemetry. Достаточно ротационного локального журнала с версией приложения, job/operation ID, категорией ошибки и stack для внутренних сбоев. Пути к музыке и содержимое тегов не должны автоматически отправляться наружу.

## Предлагаемый порядок работ

1. Исправить `Escape`, изоляцию Playwright, позднюю CSS-проверку и benchmark.
2. Получить зелёные unit/integration, Chrome, Edge и обновлённый 100k benchmark.
3. Обновить README/ROADMAP и зафиксировать milestone 0.1.
4. P1.8–P1.10 закрыты: facet-запросы измерены и оптимизированы, SQLite обслуживается безопасно, CI стал quality gate.
5. P2.1–P2.2, первый срез P2.3–P2.4 и второй scanner-срез P2.3 закрыты: client panels, dialogs, CSS entrypoint, repository-границы, migrations runner, worker/SSE contracts и library scanning разделены без изменения внешних контрактов. Следующий этап — декомпозиция preview/execute/recovery и общие route/client response contracts.
6. Решения о materialized folder relation, watcher и code splitting принимать только после повторных измерений.

## Критерий завершения milestone 0.1

Milestone можно считать технически закрытым, когда:

- typecheck, unit/integration и production build зелёные;
- полный Playwright стабильно проходит отдельно в Chrome и Edge без зависимости от порядка тестов;
- benchmark проверяет актуальные контракты и публикует воспроизводимый baseline;
- README и roadmap описывают фактически реализованный релизный контур;
- известный дефект `Escape` исправлен;
- все остальные пункты этого документа либо оформлены как backlog следующего этапа, либо сознательно отклонены с коротким объяснением.

На этом этапе функциональность не нужно расширять. Главная задача — сделать уже работающий продукт измеряемым, сопровождаемым и безопасным для следующего цикла изменений.
