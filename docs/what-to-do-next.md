# Что делать дальше: бесплатная подпись stable-версий

Это инструкция для владельца MyMusicLib. Ничего из этого не нужно делать для обычных unsigned beta-релизов: они уже можно публиковать как GitHub prerelease.

## 1. Сначала опубликовать изменения GPL

1. Просмотрите изменения текущего этапа, закоммитьте их и отправьте в `main`.
2. Проверьте на GitHub, что видны файл `LICENSE`, значение `GPL-3.0-only` в `package.json` и публичный исходный код.
3. Не добавляйте в репозиторий закрытые ключи, музыку, персональные каталоги или платные/закрытые компоненты: для бесплатного SignPath проект должен оставаться полноценным OSS.

## 2. Подать заявку в SignPath Foundation

1. Откройте [SignPath Foundation](https://signpath.org/) и подайте заявку на бесплатную code signing для open-source проекта.
2. Укажите репозиторий `https://github.com/grouzdev/my-music-lib`, лицензию GPL-3.0-only и назначение: Windows Electron installer и portable EXE.
3. Подтвердите, что вы поддерживаете проект и имеете право выпускать его сборки.
4. Дождитесь одобрения. До этого stable-тег создавать не нужно: workflow специально остановится без credentials.

Важно: Windows будет показывать издателя **SignPath Foundation**, а не ваше имя. Это нормальное условие бесплатной OSS-подписи.

## 3. Настроить SignPath после одобрения

В кабинете SignPath создайте один проект MyMusicLib и release signing policy с GitHub origin verification:

- repository: только `grouzdev/my-music-lib`;
- источник: GitHub Actions;
- runner: только GitHub-hosted;
- разрешённые refs: stable-теги `vX.Y.Z`, без `-beta.N`;
- не разрешайте подпись вручную из произвольных файлов.

Создайте две artifact configurations и сохраните их slugs:

| Configuration | Входной файл | Что подписывает |
|---|---|---|
| `unpacked` | ZIP содержимого `release/win-unpacked` | исполняемые файлы Electron-приложения |
| `distributables` | ZIP с Setup EXE и portable EXE | два внешних дистрибутива |

При создании конфигураций используйте sample artifact из первой workflow-прогона только после настройки environment; SignPath должен вернуть archive с теми же именами файлов. Не включайте в подпись сторонние файлы, которые уже должны иметь собственную подпись.

## 4. Настроить GitHub environment

На GitHub: **Settings → Environments → New environment**, имя строго `stable`.

Включите **Required reviewers** и добавьте себя: это будет последним ручным подтверждением перед выпуском stable. В этом environment добавьте:

**Secrets**

- `SIGNPATH_API_TOKEN`
- `SIGNPATH_GITHUB_EXTENDED_VERIFICATION_TOKEN`

**Variables**

- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_RELEASE_POLICY_SLUG`
- `SIGNPATH_UNPACKED_CONFIGURATION_SLUG`
- `SIGNPATH_DISTRIBUTABLE_CONFIGURATION_SLUG`

Значения выдаёт SignPath; не вставляйте secrets в файл workflow или в git history.

## 5. Сверить имя издателя

После выдачи сертификата посмотрите его subject/CN в SignPath. Он должен совпасть с `SignPath Foundation`, уже указанным в `electron-builder.yml` и в проверке workflow. Если SignPath выдаст другое точное имя, сообщите его разработчику: нужно заменить оба сравнения до первого release.

## 6. Выпустить первый signed stable

1. Убедитесь, что `package.json` содержит stable-версию без `-beta`, например `0.1.0`.
2. Локально запустите `npm run typecheck` и `npm test`.
3. Закоммитьте версию, отправьте `main`, затем создайте и отправьте тег `v0.1.0`.
4. В GitHub Actions откройте job **Publish Windows releases → publish-stable**, проверьте commit/tag и подтвердите environment `stable`.
5. Дождитесь конца job. В GitHub Release должны быть только:
   - `MyMusicLib-0.1.0-x64-Setup.exe`;
   - `MyMusicLib-0.1.0-x64-portable.exe`;
   - `latest.yml`.

Не должно быть `unsigned` в именах stable-файлов. `blockmap` не публикуется намеренно: подпись меняет Setup EXE, а `latest.yml` создаётся уже после подписи.

## 7. Проверить первый релиз

На чистой Windows 10/11 машине без Node.js:

1. Скачать Setup EXE из GitHub Release, открыть его свойства и убедиться, что вкладка цифровых подписей валидна.
2. Установить приложение, запустить, подключить тестовую папку и проверить воспроизведение/сканирование/запись тега.
3. В PowerShell выполнить:

```powershell
Get-AuthenticodeSignature .\MyMusicLib-0.1.0-x64-Setup.exe
```

Ожидается `Status: Valid`.

4. Выпустить следующий signed stable, например `0.1.1`, и проверить из установленной `0.1.0` ручное скачивание и установку обновления.
5. После обновления проверить, что каталог, библиотеки, закладки, журнал и recovery сохранились.

Если SignPath отклонит заявку или workflow не пройдёт настройку, не выпускайте pseudo-stable вручную. Продолжайте публиковать unsigned beta-теги `vX.Y.Z-beta.N` и вернитесь к этой инструкции после решения проблемы.
