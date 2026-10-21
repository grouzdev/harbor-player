---
id: project.review
kind: source
---
# Проверка первой карты

## Условия

Обзор 21 октября 2026 года, исходники `d3aceccfe3b0131711c20cbc47891da79c2ab7a6`.
Команды выполняются из `F:\Dev\Forma`, страницы — `.forma` репозитория
`F:\Dev\MyMusicLib`. Приложение, реальные музыкальные данные и сеть не используются.
Результаты структурных запусков записаны ниже отдельно от смысловой самооценки.

## Команды

```powershell
npm.cmd run forma -- graph schema --version 0.2
npm.cmd run forma -- check F:/Dev/MyMusicLib/.forma
```

Для всех команд `graph check` и `graph layer` используется один и тот же набор
явных разрешений; PowerShell splatting только сокращает запись аргументов:

```powershell
$mapArgs = @(
  '--repo', 'F:/Dev/MyMusicLib', '--pages', '.forma',
  '--allow-source', 'concept.md', '--allow-source', 'README.md',
  '--allow-source', 'package.json', '--allow-source', 'src/client',
  '--allow-source', 'src/server', '--allow-source', 'src/desktop',
  '--allow-source', 'tests/playlists.test.ts',
  '--allow-source', 'tests/service.test.ts',
  '--allow-source', 'tests/pulse-recorder.test.ts',
  '--allow-source', 'docs/pulse/reference.md',
  '--allow-source', 'docs/pulse-next-steps.md',
  '--allow-source', 'docs/backlog.md',
  '--allow-source', 'website/README.md',
  '--allow-source', 'website/src/content/copy.ts',
  '--allow-source', 'website/src/config/release.ts'
)
npm.cmd run forma -- graph check @mapArgs --require-summaries --format json
npm.cmd run forma -- graph layer @mapArgs --format json
npm.cmd run forma -- graph layer @mapArgs --id harbor.listening --format json
npm.cmd run forma -- graph layer @mapArgs --id collection.playlists --format json
npm.cmd run forma -- graph layer @mapArgs --id playlists.implementation --format json
```

## Отдельная смысловая сверка всех объяснений

Это ручная сверка Codex текста каждого узла с его основаниями, отдельно
от автоматического подсчёта `summaryCoverage`. Статус `sourced` не означает
человеческого одобрения; `reviewedBy` и `reviewedAt` не назначены.

| ID | Основание и предел объяснения |
| --- | --- |
| harbor.collection | concept + README: человек с локальной музыкой, Windows сейчас, другие платформы и стриминг в замысле |
| harbor.listening | README + browsing + player: папки, фильтры, отдельная очередь; не обещана смена очереди от фильтров |
| harbor.organizing | README + preview/write: теги и файлы; восстановление прямо ограничено настройками и копиями |
| harbor.pulse | README + документ приёмки + backlog: локальная история, документированный статус beta.2, исключения видимы |
| harbor.beta | README + backlog + сайт + API: Windows beta, stable не подтверждён, расхождение плейлистов показано |
| catalog.scanning | scanner 1–100: обход папок, размер/mtime и недоступность; нет заявления об абсолютной полноте индексации |
| catalog.browsing | README + browsing 1–130: выбор и поиск; поведение очереди взято из README |
| player.audio | player + App 3839–3883: audio и постоянный Player рядом с режимами; это чтение реализации |
| operations.files | preview + write + orchestrator: staging, хеши, занятый путь, recovery; без гарантии безусловного отката |
| metadata.lookup | README: ручной выбор издания и полей; живые сетевые запросы не проверены |
| collection.playlists | UI + API + tests: подборки разных видов, импорт/экспорт/sync; без новой пользовательской приёмки |
| playlists.implementation | API + UI + parser: конкретные действия и форматы; runtime-работоспособность не объявлена |
| catalog.tests | Прочитанные тесты сервиса и плейлистов: описаны assertions, запуск явно отсутствует |
| pulse.recording | recorder + player + reference: реальное время, outbox, revisions, checkpoint; не lossless-гарантия |
| pulse.storage | store + ingest + reference: SQLite, очистка поколения, запрет смены зоны; без оценки всех миграций |
| pulse.acceptance | pulse-next-steps + backlog: сообщение документов о прошлой приёмке; не новая приёмка и не stable |
| pulse.limitations | backlog + README: timeout/Edge/injection/manual gaps и возможная потеря хвоста; риски не названы устранёнными |
| pulse.tests | recorder tests 40–115: скорости, jitter и clock gap; тесты не объявлены выполненными |
| desktop.shell | main + updater + README: utility process, отдельные действия обновления, отключённая автоустановка |
| website.landing | README сайта + release config: Astro EN/RU и null download links; состояние публикации неизвестно |
| website.playlist-gap | copy сайта + UI/API/tests: обе локальные языковые версии расходятся с существующей реализацией |
| release.stable-gap | backlog + README + concept: RELEASE-01, другие ОС и сетевой доступ не приписаны готовой версии |

## Понятность первого экрана

Обычный `graph layer` показал все пять карточек, `hidden: 0`, в следующем порядке:

| Видимая карточка | Видимое краткое объяснение |
| --- | --- |
| Бета и дальнейшее развитие | Реализованы Windows-приложение, обновления и сайт. Подписанный stable ещё требует фактической проверки; сайт относит плейлисты к планам, хотя в приложении уже существует их реализация. |
| Harbor Player — личная музыкальная коллекция | Локальный плеер и каталогизатор для человека, который хранит музыку на компьютере. Текущие дистрибутивы предназначены для Windows; кроссплатформенность и стриминг остаются направлениями развития. |
| От папок к прослушиванию | Подключение музыкальных папок, отбор по жанрам, исполнителям и альбомам, запуск треков и работа с очередью. Фильтры каталога позволяют искать следующую музыку во время воспроизведения. |
| Порядок в коллекции | Пакетная правка тегов, поиск сведений и обложек через MusicBrainz, перенос и удаление файлов с предварительным просмотром и журналом. Восстановление зависит от сохранённых копий и настроек recovery. |
| Пульс — история прослушивания | Локальная история альбомов по дням и статистика фактического времени воспроизведения. По проектным документам первый этап принят для beta.2 с сохранёнными ограничениями надёжности и ручной проверки. |

Сверка проводится по видимым названиям и summary, без подмены их скрытым документом:

- Что и для кого: «Harbor Player — личная музыкальная коллекция» прямо называет
  локальный плеер-каталогизатор для человека с музыкой на компьютере.
- Как пользоваться: «От папок к прослушиванию» описывает подключение папок,
  выбор жанров/исполнителей/альбомов и запуск очереди; «Порядок в коллекции»
  добавляет правку тегов и файлов.
- Особенность: сочетание локальной коллекции, MusicBrainz, управляемых операций
  и «Пульса» с фактическим временем прослушивания объясняет предмет программы.
- Замысел, существующее и пробел: первая карточка отделяет Windows от будущих
  платформ и стриминга; «Пульс» называет принятую beta.2 с ограничениями;
  «Бета и дальнейшее развитие» показывает неподтверждённый stable и расхождение сайта.

Это самооценка агента, не человеческая приёмка понятности.

## Маршрут к основанию

`harbor.listening` → `collection.playlists` → `playlists.implementation` →
`source.playlist-api` (`src/server/app.ts`, строки 651–760).
Раскрытие добавляет создание/изменение подборок, порядок записей, экспорт и sync;
`source.playlist-formats` раскрывает поддержанные форматы импорта.

## Итоги запусков

Все указанные выше команды завершились с кодом 0:

- Схема получена от локальной Forma `0.1.5` до записи графа.
- `check`: 11 страниц, 30 ссылок, 0 исполняемых сценариев; ошибок структуры нет.
- `graph check --require-summaries`: 22 узла, заполнено 22 объяснения,
  `missing: []`. Во всей карте пропущенных ID нет. Всего 23 связи и 30 источников.
- Все 30 источников имеют статус `matched`; `unpinned`, `changed` и
  `unavailable` отсутствуют. Совпадение хеша не доказывает истинность текста.
- Две ожидаемые диагностики `NO_RECORDED_RUN`: `catalog.tests` и `pulse.tests`.
  Они оставлены намеренно: наличие тестов не выдаётся за их выполнение.
  Обычная проверка успешна с этими предупреждениями; `--strict` не запускался.
- Обычный `graph layer`: `total: 5`, `hidden: 0`, без фокуса/поиска/фильтра
  и изменения лимитов. Тексты всех пяти карточек приведены выше.
- `harbor.listening`: 4 карточки — плейлисты, сценарий выбора, сканирование,
  плеер. `collection.playlists`: 3 карточки — тесты, реализация, расхождение сайта.
  `playlists.implementation`: связь с понятием плейлистов; её content указывает
  на `source.playlist-api`, строки 651–760, хеш совпал. Во всех маршрутах `hidden: 0`.

Отдельная сверка всех 22 объяснений проведена по таблице выше. Четыре вопроса
понятности первого экрана получили ответы из видимого слоя; это самооценка Codex.
Просмотр в браузере и человеческая приёмка карты не выполнялись.

`git diff --check` прошёл; tracked diff пуст. Поскольку `.forma` изначально
untracked, дополнительно сравнены SHA-256 существовавших файлов: изменён только
`.forma/index.md`, добавлено семь файлов внутри `.forma`. Ядро, state.json,
skills и AGENTS.md сохранили исходные байты. Проверка новых файлов на завершающие
пробелы и незавершённые маркеры конфликтов выполняется отдельно от Git diff.
Коммита нет; исходные untracked-файлы сохранены. Тесты и сборка приложения
не запускались согласно границам документационной задачи.
