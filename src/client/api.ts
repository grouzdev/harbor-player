import type { CatalogFilter } from '../shared/contracts';

let csrf = '';
export function setCsrf(token: string) { csrf = token; }
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Ошибка запроса (${response.status})`); }
  return response.json();
}
export function catalogUrl(endpoint: string, filter: CatalogFilter, offset = 0, limit = 200) { return `/${endpoint}?${new URLSearchParams({ filter: JSON.stringify(filter), offset: String(offset), limit: String(limit) })}`; }
export function duration(seconds: number) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
export const count = (n: number) => n.toLocaleString('ru-RU');
export const fieldLabels: Record<string, string> = { title: 'Название', artists: 'Исполнители', albumTitle: 'Альбом', albumArtists: 'Исполнители альбома', genres: 'Жанры', year: 'Год', trackNumber: 'Номер трека', discNumber: 'Номер диска', cover: 'Обложка' };
export const operationLabels = { move: 'Перенос', trash: 'Удаление', tags: 'Изменение тегов', restore: 'Восстановление' };
