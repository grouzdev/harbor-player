Windows standalone-версия MyMusicLib с обновлениями

## Кратко и простыми словами

MyMusicLib следует упаковать в Electron-приложение: пользователь устанавливает обычный Windows installer, запускает программу из меню «Пуск» и не устанавливает Node.js, npm или Git. Текущий React-интерфейс открывается в отдельном окне, а существующий Node/Fastify backend работает внутри дистрибутива.

Выбранная схема:

- Windows 10/11 x64.
- Основной дистрибутив — NSIS installer для текущего пользователя без UAC.
- Дополнительно — no-install portable EXE; каталог, recovery и база обеих версий остаются в `%LOCALAPPDATA%\MyMusicLib`, а Chromium-профиль — в подпапке `electron`.
- Закрытие окна сворачивает приложение в tray; явный «Выход» останавливает backend.
- Пункт меню «Открыть в браузере» открывает тот же локальный интерфейс.
- Приложение само проверяет GitHub Releases, но ничего не скачивает без кнопки пользователя.
- Неподписанные beta-релизы разрешены и явно маркируются; стабильные релизы блокируются до настройки Windows code signing.

Electron 44 использует Node.js 24, то есть соответствует текущему runtime проекта. Electron официально поддерживает utility-процессы для вынесения Node/SQLite backend из UI-процесса, а electron-builder поддерживает NSIS-обновления и отдельный portable target. [Electron 44 runtime](https://releases.electronjs.org/release/v44.0.0), [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [Windows targets](https://www.electron.build/v26/docs/targets/).

## Архитектура приложения

- Добавить Electron main process, который:
  - до `ready` переносит `userData` и `sessionData` в `%LOCALAPPDATA%\MyMusicLib\electron`;
  - получает single-instance lock и при повторном запуске показывает существующее окно;
  - запускает backend в отдельном `utilityProcess`;
  - ждёт сообщения `ready` и только после этого открывает `BrowserWindow`;
  - загружает `http://127.0.0.1:4317`;
  - создаёт системное меню и tray с командами «Показать», «Открыть в браузере», «Проверить обновления», «Выход»;
  - при обычном закрытии окна скрывает его в tray, не останавливая музыку и браузерный режим;
  - не добавляет приложение в автозапуск Windows.

- Вынести запуск Fastify из CLI-entrypoint в переиспользуемый `startLocalServer()`:
  - возвращать фактический URL и асинхронный `stop()`;
  - сохранять текущий CLI-запуск для разработки;
  - использовать прежний `%LOCALAPPDATA%\MyMusicLib`, порт 4317, instance lock, сканирование и пятиминутный таймер;
  - при занятом порте показывать понятную ошибку и завершаться, не переключаясь молча на другой адрес.
  - перед остановкой запрещать новые jobs, убирать таймер сканирования, прекращать приём HTTP-запросов и дожидаться текущей очереди.

- Сохранить изоляцию записи тегов:
  - передавать в `MusicService` интерфейс `TagWriter`, а не жёстко вызывать `child_process.fork`;
  - обычный Node-режим продолжает использовать нынешний дочерний процесс;
  - Electron backend передаёт запрос main process, а тот создаёт одноразовый tag-writer `utilityProcess`;
  - падение обработчика остаётся локальным и попадает в существующий механизм recovery;
  - после этого отключить Electron fuse `runAsNode`, не оставляя возможность использовать приложение как произвольный Node executable.

- Упаковать `dist/client`, серверные и desktop-entrypoints, `verification/tag-support.json`, production-зависимости и notices. Нативные файлы `better-sqlite3` и `sharp` явно оставить вне ASAR и проверять в собранном приложении; Electron предупреждает, что native addons требуют совместимой сборки и распаковки из ASAR. [Native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), [ASAR contents](https://www.electron.build/docs/contents/).

- Окно создавать с `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; навигацию и новые окна ограничить локальным origin. Внешние ссылки открывать только после проверки протокола `https:`.

## Обновления и интерфейсы

- Добавить минимальный preload bridge, отсутствующий в обычном браузере:

  - `getAppInfo(): { version, portable }`;
  - `getUpdateState(): UpdateState`;
  - `checkForUpdates()`;
  - `downloadUpdate()`;
  - `installUpdate()`;
  - `subscribeUpdateState(listener)`.

- `UpdateState` сделать явным union-типом: `idle`, `checking`, `available`, `downloading`, `downloaded`, `preparingInstall`, `upToDate`, `unsupported`, `error`, с версией и процентом там, где они применимы. `preparingInstall` отображает ожидание безопасного завершения файловой операции, `unsupported` используется portable-сборкой.

- Использовать `electron-updater` с GitHub Releases:
  - `autoDownload = false`;
  - `autoInstallOnAppQuit = false`;
  - фоновая проверка через 30 секунд после запуска и затем раз в 6 часов;
  - ручная проверка из меню всегда показывает результат;
  - при найденной версии показать Windows-уведомление и компактную панель в desktop-интерфейсе;
  - кнопка «Скачать» запускает загрузку и показывает прогресс;
  - после загрузки доступны «Перезапустить и установить» и «Позже»;
  - обычный выход не устанавливает уже скачанную версию без отдельного подтверждения.

- Перед установкой обновления:
  - прекратить принимать новые HTTP-запросы;
  - дождаться завершения активной операции записи/переноса/recovery;
  - закрыть аудиопотоки, worker threads, SQLite и instance lock;
  - только затем вызвать установщик обновления;
  - если завершение требует времени, показывать состояние «Ожидаем завершения операции», не убивать backend принудительно.

- В браузерном интерфейсе Electron bridge отсутствует, поэтому панель обновления не отображается. Управление обновлением остаётся в desktop-окне и tray.

- Portable-сборку определять через `PORTABLE_EXECUTABLE_DIR`. Для неё отключить фоновые проверки и установку: пункт «Проверить обновления» открывает страницу Releases. Portable target официально предусматривает ручное обновление, тогда как NSIS поддерживает `electron-updater`. [Portable environment](https://www.electron.build/nsis/), [electron-updater](https://www.electron.build/docs/features/auto-update/).

## Сборка и публикация

- Зафиксировать `electron@44.4.1`, `electron-builder@26.15.3`, `@electron/fuses@2.1.3`; на этапе обновлений добавить `electron-updater@6.8.9`.
- Настроить electron-builder:
  - `appId: com.grouzdev.mymusiclib`;
  - `productName: MyMusicLib`;
  - x64 targets: `nsis` и `portable`;
  - per-user one-click installer без прав администратора;
  - ярлыки в меню «Пуск» и на рабочем столе;
  - существующий ICO;
  - GitHub provider `grouzdev/my-music-lib`;
  - понятные имена артефактов с версией, архитектурой и отметкой `unsigned` для beta.

- Версию брать только из `package.json`; release tag обязан точно совпадать с `v<version>`.
  - Stable: `0.x.y`.
  - Beta: `0.x.y-beta.n`.
  - Stable-клиенты не получают beta; beta-клиенты получают последующие beta и stable.
  - включить `generateUpdatesFilesForAllChannels` и задавать GitHub channel явно: `latest` для stable, `beta` для prerelease;
  - Нельзя превращать уже опубликованную неподписанную beta в stable: stable собирается заново из отдельного тега.

- Добавить GitHub Actions на Windows:
  - `npm ci`, typecheck, unit/integration tests, production build;
  - проверка tag-support manifest и полного набора runtime-файлов;
  - сборка installer и portable;
  - запуск packaged smoke test;
  - публикация release assets и update metadata (`latest*.yml`, blockmap);
  - beta публикуется как GitHub prerelease;
  - stable job использует защищённое environment и падает, если Windows-подпись отсутствует.

- До получения сертификата публичная beta допускается, но release notes и имена файлов явно предупреждают о SmartScreen. Стабильный релиз требует публично доверенного Authenticode-сертификата, SHA-256 timestamp и проверки подписи через `signtool verify`. Конкретный CA или облачный signing provider выбирается отдельно после проверки доступности для юридического лица; Azure Artifact Signing имеет региональные ограничения. [Microsoft signing prerequisites](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).

- Обновить README и notices:
  - установка, tray и полный выход;
  - desktop и браузерный режимы;
  - различие installer/portable;
  - политика beta/stable;
  - расположение данных и то, что uninstall намеренно не удаляет каталог, recovery и базу.

## Roadmap реализации

1. **Desktop core — реализован.** Переиспользуемый lifecycle Fastify, внедряемый `TagWriter`, Electron main/backend/tag utility processes, single instance, tray, безопасное окно и unpacked x64-сборка. Packaged smoke проверяет SQLite, Sharp, worker scan, HTTP Range и запись тега; fuse `runAsNode` отключён.
2. **Дистрибутивы.** Добавить per-user NSIS installer и portable EXE, ярлыки, корректный uninstall без удаления пользовательских данных и ручную проверку на чистой Windows VM.
3. **Обновления — реализован.** Preload API и `UpdateState`, beta/latest channels, ручное скачивание, portable fallback на Releases и подготовка backend к подтверждённому restart/install. Ожидающие сканирования отменяются, активные файловые операции завершаются безопасно.
4. **Release pipeline.** Добавить Windows GitHub Actions, публикацию unsigned beta, update metadata и реальный тест `beta N → beta N+1`.
5. **Stable.** Подключить выбранного signing provider, Authenticode с timestamp, защищённое environment и проверку подписи перед публичным stable.

## Проверки и критерии готовности

- Сохранить все существующие Node/Vitest/Playwright проверки без изменения браузерного контракта.
- Добавить unit-тесты для lifecycle backend, single-instance, tray, update state machine и IPC tag-writer.
- На чистой Windows x64 VM без Node.js, npm и Git проверить:
  - установку, запуск без консольного окна и удаление;
  - сканирование, воспроизведение, HTTP Range, обложки, MusicBrainz;
  - запись тегов каждого подтверждённого формата и recovery после искусственного падения tag utility;
  - открытие браузера из меню;
  - закрытие в tray, продолжение работы браузерной вкладки и полный выход;
  - повторный запуск без второго backend/SQLite-процесса;
  - запуск portable EXE и использование того же `%LOCALAPPDATA%\MyMusicLib`.

- Провести реальный update-тест `beta N → beta N+1`:
  - уведомление появляется, но загрузка сама не начинается;
  - загрузка стартует только после кнопки;
  - установка требует отдельного подтверждения;
  - активная файловая операция завершается безопасно до рестарта;
  - после обновления сохранены библиотеки, каталог, закладки, журнал и recovery;
  - версия в приложении и update metadata совпадает.

- Готовность считается достигнутой, когда installer и portable работают на машине без инструментов разработки, packaged tag/audio smoke проходит, обновление между двумя реально установленными версиями подтверждено, а `git status` после сборки не содержит неожиданных изменений.

## Зафиксированные ограничения

- Только Windows 10/11 x64; ARM64, macOS, Linux и Microsoft Store не входят в первую версию.
- Автообновляется только установленная NSIS-версия.
- Portable означает «без установки», но пользовательские данные не переносимы вместе с EXE.
- Нет автозапуска с Windows.
- Не меняются схема каталога, HTTP API и формат пользовательских данных.
- Стабильная публичная версия не выпускается без Windows code signing; до этого разрешены только явно обозначенные неподписанные beta-релизы.
