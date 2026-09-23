export const copy = {
  en: {
    title: 'Harbor Player — Collect, not consume',
    description: 'A music player and organizer for your local collection.',
    slogan: ['Collect,', 'not consume'],
    skip: 'Skip to content',
    download: 'Download for Windows',
    soon: 'Download coming soon',
    unsigned: 'Unsigned beta. Windows may show a SmartScreen warning.',
    screenshot: 'Harbor Player, Russian interface: music folders, genres, artists, album covers and a track list.',
    enlarge: 'View full screenshot',
    features: [
      'Browse folders, genres, artists and albums.',
      'Listen to and organize your music collection.',
      'Edit tags in batches. Find metadata and cover art through MusicBrainz.',
      'Preview changes and restore files or tags through the operation history.',
    ],
    license: 'GPL-3.0 license',
  },
  ru: {
    title: 'Harbor Player — Коллекционируй, а не потребляй',
    description: 'Музыкальный плеер и каталогизатор для вашей локальной коллекции.',
    slogan: ['Коллекционируй,', 'а не потребляй'],
    skip: 'Перейти к содержимому',
    download: 'Скачать для Windows',
    soon: 'Скачивание скоро',
    unsigned: 'Бета без цифровой подписи. Windows может показать предупреждение SmartScreen.',
    screenshot: 'Harbor Player, русский интерфейс: музыкальные папки, жанры, исполнители, обложки альбомов и список треков.',
    enlarge: 'Открыть скриншот целиком',
    features: [
      'Навигация по папкам, жанрам, исполнителям и альбомам.',
      'Прослушивание и организация музыкальной коллекции.',
      'Пакетное редактирование тегов, сведения и обложки из MusicBrainz.',
      'Предпросмотр изменений и восстановление через журнал.',
    ],
    license: 'Лицензия GPL-3.0',
  },
} as const;
export type Locale = keyof typeof copy;
export type Copy = (typeof copy)[Locale];
