# Signed stable через SignPath Foundation

Harbor Player использует бесплатную OSS-подпись SignPath Foundation. Репозиторий должен оставаться публичным и распространяться под GPL-3.0-only. Издатель Windows будет `SignPath Foundation`.

## Однократная настройка

1. Подать `grouzdev/harbor-player` в SignPath Foundation и дождаться одобрения.
2. В SignPath создать release signing policy с GitHub origin verification: только этот репозиторий, stable-теги и GitHub-hosted runners.
3. Создать две artifact configurations:
   - `unpacked`: ZIP содержимого `release/win-unpacked`; подписывает исполняемые файлы приложения, необходимые для Windows.
   - `distributables`: ZIP с NSIS Setup EXE и portable EXE; подписывает оба внешних файла.
4. В GitHub создать environment `stable`, включить required reviewers и добавить secrets `SIGNPATH_API_TOKEN`, `SIGNPATH_GITHUB_EXTENDED_VERIFICATION_TOKEN`.
5. В том же environment добавить variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_RELEASE_POLICY_SLUG`, `SIGNPATH_UNPACKED_CONFIGURATION_SLUG`, `SIGNPATH_DISTRIBUTABLE_CONFIGURATION_SLUG`.
6. Сверить certificate subject, выданный SignPath, с `publisherName` в `electron-builder.yml`. Если CN отличается от `SignPath Foundation`, заменить это значение и проверку в release workflow на точный subject сертификата.

## Выпуск

1. Указать в `package.json` стабильную версию `X.Y.Z`, выполнить локальные проверки и закоммитить изменение.
2. Создать и отправить неизменяемый тег `vX.Y.Z`.
3. Подтвердить job `publish-stable` в environment `stable`.
4. Проверить GitHub Release: Setup EXE, portable EXE и `latest.yml`; `unsigned` и blockmap от промежуточной упаковки не публикуются.
5. Установить Setup EXE на чистую Windows VM и проверить `Get-AuthenticodeSignature`, запуск, обновление до следующего signed stable и сохранность пользовательских данных.

Beta-теги `vX.Y.Z-beta.N` не используют SignPath и продолжают публиковаться как unsigned prerelease.
