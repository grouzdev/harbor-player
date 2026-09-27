# Следующие шаги

Этот документ содержит только незавершённую работу. Исторические планы,
технические аудиты и разовые измерения доступны в Git.

## Подпись и первый signed stable

Заявка в SignPath Foundation подана. До её одобрения stable-тег не создавать;
unsigned beta-релизы продолжают выпускаться обычным порядком.

После одобрения:

1. Создать SignPath release signing policy с GitHub origin verification только
   для репозитория, stable-тегов и GitHub-hosted runners.
2. Создать artifact configurations для Electron bundle и внешних
   дистрибутивов; добавить их slugs, secrets и variables в защищённый GitHub
   environment `stable`.
3. Сверить точный subject выданного сертификата с `publisherName` и проверкой
   release workflow.
4. Выпустить первый signed stable и проверить GitHub Release: Setup EXE,
   portable EXE и `latest.yml` без суффикса `unsigned`.
5. На чистой Windows VM проверить валидность Authenticode-подписи, установку,
   запуск и обновление до следующего signed stable с сохранением библиотеки,
   каталога, закладок, журнала и recovery.

## Отложенный продуктовый backlog

- Добавить Chromaprint/AcoustID для файлов с недостаточными или неверными
  исходными тегами.
- Спроектировать домашний сетевой доступ только вместе с отдельными
  настройками, аутентификацией, ролями «слушать»/«изменять» и адаптацией для
  небольших экранов. Текущий локальный API в сеть не открывать.
