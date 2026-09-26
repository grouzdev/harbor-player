# Следующая итерация: стабилизация E2E и выпуск `v0.2.1-beta.2`

## Исходное состояние

Тег `v0.2.1-beta.1` уже создан. Его GitHub Actions workflow остановился на `npm run test:e2e`, поэтому beta-релиз и его артефакты не опубликованы. Тег не перемещать и не переиспользовать.

## План

1. Продолжить диагностировать сценарий `local library: readable UI, playback, tags, move and permanent delete` сначала в Edge. Устранить оставшиеся нестабильные проверки состояния и фокуса, не ослабляя проверки пользовательского результата.
2. Запустить этот сценарий отдельно в Chrome и Edge:

   ```powershell
   npx playwright test tests/browser/library.spec.ts --project=chrome --project=edge --grep "local library: readable UI, playback, tags, move and permanent delete"
   ```

3. После его прохождения выполнить полный браузерный набор:

   ```powershell
   npm run test:e2e
   ```

4. Если набор зелёный, проверить сборку Windows и подготовить новую версию:

   ```powershell
   npm run release:prepare -- 0.2.1-beta.2
   ```

5. Закоммитить только изменение версии и связанные release-файлы, отправить `main`, создать и отправить новый тег `v0.2.1-beta.2`.
6. После успешного workflow убедиться, что GitHub prerelease содержит unsigned Setup EXE, blockmap, portable EXE и `beta.yml`. Установить `beta.1` на другой ПК и проверить получение/установку обновления до `beta.2`.

## Критерий готовности

Не выпускать `beta.2`, пока `npm run test:e2e` не завершится успешно. Ошибки, не относящиеся к этому изменению, зафиксировать отдельной задачей с логом и воспроизведением.
