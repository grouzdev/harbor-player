import type { CatalogFilter } from "../shared/contracts";

let csrf = "";
export function setCsrf(token: string) {
  csrf = token;
}
let reconnect: Promise<void> | undefined;
export function reconnectSession(): Promise<void> {
  if (!reconnect)
    reconnect = fetch("/api/session")
      .then(async (r) => {
        if (!r.ok) throw new Error("Локальный сервер недоступен");
        const session = await r.json();
        csrf = session.csrf;
      })
      .finally(() => {
        reconnect = undefined;
      });
  return reconnect;
}
export async function api<T>(
  url: string,
  body?: unknown,
  method: "GET" | "POST" | "DELETE" = body === undefined ? "GET" : "POST",
): Promise<T> {
  const request = () =>
    fetch(`/api${url}`, {
      method,
      headers:
        method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let response = await request();
  if (response.status === 401) {
    await reconnectSession();
    response = await request();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Ошибка запроса (${response.status})`);
  }
  return response.json();
}
export type CoverFilePatch = {
  data: string;
  mime: "image/jpeg" | "image/png";
};
export async function prepareCoverFile(file: File): Promise<CoverFilePatch> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Выберите JPEG, PNG или WebP до 10 МБ");
  const webp = file.type === "image/webp" || /\.webp$/i.test(file.name);
  const supported = webp || ["image/jpeg", "image/png"].includes(file.type);
  if (!supported) throw new Error("Выберите JPEG, PNG или WebP до 10 МБ");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Не удалось прочитать файл обложки"));
    reader.onload = () => {
      const value =
        typeof reader.result === "string" ? reader.result.split(",")[1] : "";
      if (value) resolve(value);
      else reject(new Error("Не удалось прочитать файл обложки"));
    };
    reader.readAsDataURL(file);
  });
  if (webp) return api<CoverFilePatch>("/covers/normalize-webp", { data });
  return { data, mime: file.type as CoverFilePatch["mime"] };
}
export function catalogUrl(
  endpoint: string,
  filter: CatalogFilter,
  offset = 0,
  limit = 200,
) {
  return `/${endpoint}?${new URLSearchParams({ filter: JSON.stringify(filter), offset: String(offset), limit: String(limit) })}`;
}
export function duration(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export const count = (n: number) => n.toLocaleString("ru-RU");
export const fieldLabels: Record<string, string> = {
  title: "Название",
  artists: "Артисты",
  albumTitle: "Альбом",
  albumArtists: "Исполнители альбома",
  genres: "Жанры",
  year: "Год",
  trackNumber: "Номер трека",
  discNumber: "Номер диска",
  cover: "Обложка",
};
export const operationLabels = {
  move: "Перенос",
  trash: "Удаление",
  tags: "Изменение тегов",
  restore: "Восстановление",
};
