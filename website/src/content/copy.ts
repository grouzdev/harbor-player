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
    featuresTitle: 'Features',
    features: [
      {
        title: 'Curate your collection',
        description: 'Bring your favorite music together in a personal local collection — free from streaming, subscriptions, and someone else’s catalog.',
      },
      {
        title: 'Explore your music',
        description: 'Connect any folders and bring scattered music together in one place. Browse folders, genres, artists, and albums.',
      },
      {
        title: 'Put things in order',
        description: 'Edit tags for multiple tracks at once and find missing information and cover art online.',
      },
    ],
    roadmapTitle: 'Roadmap',
    roadmap: [
      { status: 'Available now', title: 'Stage 1 — Current release', description: 'Play, organize, and care for your local music on Windows.', current: true },
      { status: 'Planned', title: 'Stage 2 — Playlists', description: 'Save the music you want to return to.', current: false },
      { status: 'Planned', title: 'Stage 3 — Cross-platform', description: 'Bring Harbor beyond Windows.', current: false },
      { status: 'Planned', title: 'Stage 4 — Mobile app', description: 'Take your music with you.', current: false },
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
    featuresTitle: 'Возможности',
    features: [
      {
        title: 'Организуй коллекцию',
        description: 'Собери любимую музыку в личную локальную коллекцию — без стримингов, подписок и зависимости от чужого каталога.',
      },
      {
        title: 'Исследуй коллекцию',
        description: 'Подключай любые папки и собирай разрозненную музыку в едином каталоге. Переходи между папками, жанрами, исполнителями и альбомами.',
      },
      {
        title: 'Наведи порядок',
        description: 'Меняй теги сразу у нескольких треков, находи в интернете недостающие сведения и обложки для релизов.',
      },
    ],
    roadmapTitle: 'Дорожная карта',
    roadmap: [
      { status: 'Доступно сейчас', title: 'Этап 1 — текущий релиз', description: 'Воспроизводи музыку, организуй библиотеку и управляй тегами на Windows.', current: true },
      { status: 'В планах', title: 'Этап 2 — плейлисты', description: 'Сохраняй музыку, к которой хочется возвращаться.', current: false },
      { status: 'В планах', title: 'Этап 3 — кроссплатформенность', description: 'Harbor выйдет за пределы Windows.', current: false },
      { status: 'В планах', title: 'Этап 4 — мобильная версия', description: 'Любимая музыка всегда с тобой.', current: false },
    ],
    license: 'Лицензия GPL-3.0',
  },
} as const;
export type Locale = keyof typeof copy;
export type Copy = (typeof copy)[Locale];
