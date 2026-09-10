import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readdir, realpath, stat, lstat, unlink, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Catalog } from './database.js';
import { Workers } from './workers.js';
import { audioExtensions, errorMessage, inside } from './config.js';
import type { Capabilities, Job, OperationItem, OperationKind, OperationPreview, Selection, TagPatch, Track } from '../shared/contracts.js';

interface JournalItem extends OperationItem { producedHash?: string; stage?: string; backup?: string; restoreExpectedHash?: string }
const exists = async (file: string) => { try { await lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };

export class MusicService extends EventEmitter {
  readonly catalog: Catalog; readonly workers = new Workers(2);
  private pending = Promise.resolve(); private active = new Set<string>(); private stopping = false;
  capabilities: Capabilities = { writableFormats: [], verificationDate: null };
  closeStreams: (trackIds: string[]) => Promise<void> = async () => {};
  constructor(readonly dataDir: string) {
    super(); this.catalog = new Catalog(dataDir);
    for (const job of this.catalog.jobs()) if (job.status === 'queued' || job.status === 'running') {
      job.status = 'error'; job.errors.push('Работа прервана остановкой сервиса'); this.catalog.saveJob(job);
    }
    for (const operation of this.catalog.history()) if (operation.status === 'running') { operation.status = 'interrupted'; this.catalog.saveOperation(operation); }
  }
  async initialize() {
    try {
      const report = JSON.parse(await readFile(new URL('../../verification/tag-support.json', import.meta.url), 'utf8'));
      const pkg = JSON.parse(await readFile(new URL('../../node_modules/@digimezzo/node-taglib-sharp/package.json', import.meta.url), 'utf8'));
      if (report.writerVersion === pkg.version) this.capabilities = { writableFormats: report.formats.filter((f: {passed:boolean}) => f.passed).map((f:{format:string}) => f.format), verificationDate: report.date };
    } catch { /* No proof of safe writes: keep the editor read-only. */ }
    await this.refreshAvailability();
  }
  async refreshAvailability() {
    for (const library of this.catalog.libraries()) {
      let available = false;
      try { available = (await stat(library.path)).isDirectory() && await realpath(library.path) === library.path; } catch { /* offline */ }
      this.catalog.db.prepare('UPDATE libraries SET available=? WHERE id=?').run(Number(available), library.id);
    }
  }
  async addLibrary(name: string, folder: string) {
    if (!path.isAbsolute(folder)) throw new Error('Укажите абсолютный путь к папке');
    const resolved = await realpath(folder);
    if (!(await stat(resolved)).isDirectory()) throw new Error('Укажите папку');
    await access(resolved, constants.R_OK);
    if (inside(resolved, this.dataDir) || inside(this.dataDir, resolved)) throw new Error('Каталог данных приложения не может быть музыкальной библиотекой');
    for (const l of this.catalog.libraries()) if (inside(l.path, resolved) || inside(resolved, l.path)) throw new Error('Эта папка или её родитель уже подключены');
    const library = this.catalog.addLibrary(name.trim() || path.basename(resolved), resolved);
    return { library, job: this.scan(library.id) };
  }
  private publish(job: Job) { this.catalog.saveJob(job); this.emit('change', { type: 'job', job }); }
  private enqueue(kind: Job['kind'], label: string, action: (job: Job) => Promise<void>, operationId?: string): Job {
    if (this.stopping) throw new Error('Сервис останавливается');
    const job: Job = { id: randomUUID(), kind, label, status: 'queued', completed: 0, total: 0, errors: [], createdAt: new Date().toISOString(), operationId };
    this.publish(job);
    this.pending = this.pending.then(async () => {
      job.status = 'running'; this.publish(job);
      try { await action(job); job.status = job.errors.length ? 'error' : 'done'; }
      catch (e) { job.status = 'error'; job.errors.push(errorMessage(e)); }
      this.publish(job); this.emit('change', { type: 'catalog' });
    });
    return job;
  }
  scan(libraryId: string, force = false): Job {
    const existing = this.catalog.jobs().find(j => j.label === `Сканирование: ${this.catalog.library(libraryId).name}` && ['queued', 'running'].includes(j.status));
    if (existing) return existing;
    return this.enqueue('scan', `Сканирование: ${this.catalog.library(libraryId).name}`, async job => {
      await this.refreshAvailability(); const library = this.catalog.library(libraryId);
      if (!library.available) throw new Error('Папка библиотеки недоступна');
      const scanId = job.id; const directories = [library.path]; let traversalComplete = true;
      const processFile = async (file: string) => {
        job.total++;
        const relative = path.relative(library.path, file);
        const old = this.catalog.db.prepare('SELECT id,size,mtimeMs FROM tracks WHERE libraryId=? AND relativePath=?').get(libraryId, relative) as {id:string;size:number;mtimeMs:number} | undefined;
        try {
          const info = await stat(file);
          if (!force && old && old.size === info.size && old.mtimeMs === info.mtimeMs) this.catalog.db.prepare('UPDATE tracks SET scanId=?,available=1 WHERE id=?').run(scanId, old.id);
          else {
            const track = await this.workers.run<Track>('read', { file, libraryId, root: library.path, id: old?.id || randomUUID(), dataDir: this.dataDir });
            this.catalog.upsert(track, scanId);
          }
        } catch (e) {
          if (old) this.catalog.db.prepare('UPDATE tracks SET scanId=? WHERE id=?').run(scanId, old.id);
          if (job.errors.length < 100) job.errors.push(`${relative}: ${errorMessage(e)}`);
        }
        job.completed++; if (job.completed % 20 === 0) this.publish(job);
      };
      while (directories.length) {
        const folder = directories.pop()!;
        let entries;
        try { entries = await readdir(folder, { withFileTypes: true }); }
        catch (e) { traversalComplete = false; if (job.errors.length < 100) job.errors.push(`${folder}: ${errorMessage(e)}`); continue; }
        const files: string[] = [];
        for (const entry of entries) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.mymusiclib-')) continue;
          const file = path.join(folder, entry.name);
          if (entry.isDirectory()) directories.push(file);
          else if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
        }
        for (let i = 0; i < files.length; i += 2) await Promise.all(files.slice(i, i + 2).map(processFile));
      }
      if (traversalComplete) this.catalog.db.prepare('UPDATE tracks SET available=0 WHERE libraryId=? AND (scanId IS NULL OR scanId<>?)').run(libraryId, scanId);
      this.catalog.db.prepare('UPDATE libraries SET lastScan=? WHERE id=?').run(new Date().toISOString(), libraryId);
    });
  }
  async safePath(file: string, destination = false, recovery = false): Promise<void> {
    const roots = this.catalog.libraries().map(l => l.path);
    if (recovery) roots.push(path.join(this.dataDir, 'recovery'));
    const root = roots.find(root => inside(root, file));
    if (!root || file === root) throw new Error('Путь вне музыкальных библиотек');
    // Check every existing ancestor: no symlink/junction traversal, including destination parents.
    const components = path.relative(root, file).split(path.sep); let cursor = root;
    if (await realpath(root) !== root) throw new Error('Папка библиотеки была подменена ссылкой');
    for (const component of components) {
      cursor = path.join(cursor, component);
      try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Операции с символическими ссылками запрещены'); }
      catch (e) { if (destination && (e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
    }
  }
  async fingerprint(file: string) {
    const before = await stat(file); const hash = await this.workers.run<string>('hash', { file }); const after = await stat(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Файл изменился при проверке');
    return { size: after.size, mtimeMs: after.mtimeMs, hash };
  }
  async preview(kind: Exclude<OperationKind, 'restore'>, selection: Selection, targetLibraryId?: string, patch?: TagPatch, companions = false): Promise<OperationPreview> {
    const tracks = this.catalog.selected(selection); if (!tracks.length) throw new Error('Выберите треки');
    const target = targetLibraryId ? this.catalog.library(targetLibraryId) : undefined;
    if (kind === 'move' && !target) throw new Error('Выберите целевую библиотеку');
    if (kind === 'tags' && (!patch || !Object.keys(patch).length)) throw new Error('Нет изменений тегов');
    const op: OperationPreview = { id: randomUUID(), kind, status: 'preview', createdAt: new Date().toISOString(), items: [], targetLibraryId, patch };
    await mkdir(path.join(this.dataDir, 'recovery', op.id), { recursive: true });
    for (const track of tracks) {
      const library = this.catalog.library(track.libraryId); const source = path.join(library.path, track.relativePath);
      const destination = kind === 'move' ? path.join(target!.path, track.relativePath) : kind === 'trash' ? path.join(this.dataDir, 'recovery', op.id, track.id + path.extname(source)) : source;
      const item: OperationItem = { id: randomUUID(), trackId: track.id, title: track.title, source, destination, size: track.size, mtimeMs: track.mtimeMs, hash: '', phase: 'preview' };
      try {
        await this.safePath(source);
        const fingerprint = await this.fingerprint(source);
        if (fingerprint.size !== track.size || fingerprint.mtimeMs !== track.mtimeMs) throw new Error('Файл изменился извне. Сначала обновите библиотеку.');
        Object.assign(item, fingerprint);
        if (kind === 'tags' && !this.capabilities.writableFormats.includes(track.format)) throw new Error(`Запись ${track.format.toUpperCase()} не прошла проверку безопасности и отключена`);
        if (kind === 'move') { await this.safePath(destination, true); if (await exists(destination)) throw new Error('В целевой папке уже есть файл с таким именем'); }
      } catch (e) { item.error = errorMessage(e); }
      op.items.push(item);
    }
    if (kind === 'move' && companions) {
      const selectedIds = new Set(tracks.map(t => t.id));
      const folders = new Set(op.items.map(i => path.dirname(i.source)));
      for (const folder of folders) {
        const selectedHere = tracks.filter(t => path.dirname(path.join(this.catalog.library(t.libraryId).path, t.relativePath)) === folder);
        const library = this.catalog.library(selectedHere[0].libraryId);
        const allHere = this.catalog.db.prepare('SELECT id,relativePath FROM tracks WHERE libraryId=? AND available=1').all(library.id) as {id:string;relativePath:string}[];
        if (allHere.some(t => path.dirname(path.join(library.path, t.relativePath)) === folder && !selectedIds.has(t.id))) continue;
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          if (!entry.isFile() || !/\.(jpg|jpeg|png|webp|cue|log|txt|pdf)$/i.test(entry.name)) continue;
          const source = path.join(folder, entry.name); const destination = path.join(target!.path, path.relative(library.path, source));
          const item: OperationItem = { id: randomUUID(), trackId: null, title: entry.name, source, destination, size: 0, mtimeMs: 0, hash: '', phase: 'preview', companion: true };
          try { await this.safePath(source); await this.safePath(destination, true); Object.assign(item, await this.fingerprint(source)); if (await exists(destination)) throw new Error('В целевой папке уже есть файл с таким именем'); }
          catch (e) { item.error = errorMessage(e); }
          op.items.push(item);
        }
      }
    }
    const destinations = new Set<string>();
    for (const item of op.items) { const key = process.platform === 'win32' ? item.destination.toLowerCase() : item.destination; if (destinations.has(key)) item.error = 'Несколько файлов имеют один целевой путь'; destinations.add(key); }
    this.catalog.saveOperation(op); return op;
  }
  async previewRestore(id: string): Promise<OperationPreview> {
    const original = this.catalog.operation(id);
    if (!['trash', 'tags'].includes(original.kind)) throw new Error('Восстановление доступно для удаления и тегов');
    const op: OperationPreview = { id: randomUUID(), kind: 'restore', status: 'preview', createdAt: new Date().toISOString(), items: [], restoreOf: id };
    for (const item of original.items as JournalItem[]) {
      if (item.phase !== 'done') continue;
      const source = original.kind === 'trash' ? item.destination : item.backup!;
      const restored: JournalItem = { ...item, id: randomUUID(), source, destination: item.source, phase: 'preview', error: undefined, stage: undefined, backup: undefined, producedHash: undefined, restoreExpectedHash: original.kind === 'tags' ? item.producedHash : undefined };
      try { await this.safePath(source, false, true); Object.assign(restored, await this.fingerprint(source)); if (original.kind === 'trash' && await exists(restored.destination)) throw new Error('Исходный путь уже занят'); }
      catch (e) { restored.error = errorMessage(e); }
      op.items.push(restored);
    }
    if (!op.items.length) throw new Error('Нет файлов для восстановления'); this.catalog.saveOperation(op); return op;
  }
  execute(id: string): Job {
    const op = this.catalog.operation(id);
    if (this.active.has(id) || op.status === 'running') throw new Error('Операция уже запущена');
    if (op.status === 'done' && op.items.every(i => i.phase === 'done' || (i.error && i.phase === 'preview'))) throw new Error('Операция уже завершена');
    this.active.add(id); op.status = 'running'; this.catalog.saveOperation(op);
    return this.enqueue('operation', ({ move: 'Перенос файлов', trash: 'Удаление с восстановлением', tags: 'Сохранение тегов', restore: 'Восстановление' })[op.kind], async job => {
      try {
        job.total = op.items.length;
        const ids = op.items.filter(i => i.trackId).map(i => i.trackId!);
        await this.closeStreams(ids);
        for (const item of op.items as JournalItem[]) {
          if (item.phase === 'done') { job.completed++; continue; }
          if (item.error && item.phase === 'preview') { if (job.errors.length < 100) job.errors.push(`${item.title}: ${item.error}`); job.completed++; continue; }
          try { await this.applyItem(op, item); item.phase = 'done'; item.error = undefined; }
          catch (e) { item.error = errorMessage(e); if (job.errors.length < 100) job.errors.push(`${item.title}: ${item.error}`); }
          job.completed++; this.catalog.saveOperation(op); this.publish(job);
        }
        op.status = 'done'; this.catalog.saveOperation(op);
      } finally { this.active.delete(id); this.emit('change', { type: 'operation-finished', operationId: id }); }
    }, id);
  }
  private async assertOriginal(item: JournalItem) {
    const actual = await this.fingerprint(item.source);
    if (actual.hash !== item.hash || actual.size !== item.size || actual.mtimeMs !== item.mtimeMs) throw new Error('Исходный файл изменился после предварительного просмотра');
  }
  private async applyItem(op: OperationPreview, item: JournalItem): Promise<void> {
    const restoringTags = op.kind === 'restore' && this.catalog.operation(op.restoreOf!).kind === 'tags';
    const editing = op.kind === 'tags' || restoringTags;
    await this.safePath(item.source, true, op.kind === 'restore');
    await this.safePath(item.destination, true, op.kind === 'trash');
    if (item.phase === 'prepared' && await exists(item.destination)) {
      const destinationHash = (await this.fingerprint(item.destination)).hash;
      if ((!editing && destinationHash === item.hash) || (editing && item.producedHash && destinationHash === item.producedHash && item.backup && await exists(item.backup))) {
        item.phase = 'copied'; this.catalog.saveOperation(op);
      }
    }
    // A verified destination can be reconciled after interruption without repeating the copy.
    if (item.phase === 'copied' && await exists(item.destination)) {
      if ((await this.fingerprint(item.destination)).hash !== (item.producedHash || item.hash)) throw new Error('Целевой файл изменился; требуется ручная проверка');
      if (!editing && await exists(item.source)) { await this.assertOriginal(item); await unlink(item.source); }
      await this.reindexItem(op, item); return;
    }
    await this.assertOriginal(item);
    await mkdir(path.dirname(item.destination), { recursive: true });
    await this.safePath(item.destination, true, op.kind === 'trash');
    if (!editing && await exists(item.destination)) throw new Error('Целевой путь занят. Исходный файл сохранён.');
    if (restoringTags && (!(await exists(item.destination)) || (await this.fingerprint(item.destination)).hash !== item.restoreExpectedHash)) throw new Error('Теги уже изменились после операции. Восстановление отменено.');
    if (editing) {
      const stage = item.stage || path.join(path.dirname(item.destination), `.mymusiclib-${op.id}-${item.id}${path.extname(item.destination)}`);
      const backup = item.backup || path.join(this.dataDir, 'recovery', op.id, item.id + path.extname(item.destination));
      item.stage = stage; item.backup = backup; item.phase = 'prepared'; this.catalog.saveOperation(op);
      await mkdir(path.dirname(backup), { recursive: true });
      // This path is generated by us and recorded before creation. Retry rebuilds only this owned copy.
      if (await exists(stage)) { await this.safePath(stage); await unlink(stage); }
      await copyFile(item.source, stage, constants.COPYFILE_EXCL);
      try {
        if (op.kind === 'tags') await this.workers.run('tags', { file: stage, patch: op.patch });
        item.producedHash = (await this.fingerprint(stage)).hash;
        if (op.kind === 'tags') await this.assertOriginal(item);
        else if ((await this.fingerprint(item.destination)).hash !== item.restoreExpectedHash) throw new Error('Файл изменился перед восстановлением');
        const expectedBackup = restoringTags ? item.restoreExpectedHash : item.hash;
        if (!(await exists(backup))) await copyFile(item.destination, backup, constants.COPYFILE_EXCL);
        if ((await this.fingerprint(backup)).hash !== expectedBackup) throw new Error('Резервная копия не прошла проверку');
        this.catalog.saveOperation(op);
        if (op.kind === 'tags') await this.assertOriginal(item);
        else if ((await this.fingerprint(item.destination)).hash !== item.restoreExpectedHash) throw new Error('Файл изменился перед заменой');
        // rename replaces atomically on the local filesystem; the original is already backed up.
        await rename(stage, item.destination);
        item.phase = 'copied'; this.catalog.saveOperation(op);
      } catch (e) { await unlink(stage).catch(() => {}); throw e; }
    } else {
      item.phase = 'prepared'; this.catalog.saveOperation(op);
      await copyFile(item.source, item.destination, constants.COPYFILE_EXCL);
      if ((await this.fingerprint(item.destination)).hash !== item.hash) throw new Error('Копия не прошла проверку. Исходник сохранён.');
      item.phase = 'copied'; this.catalog.saveOperation(op);
      await this.assertOriginal(item); await unlink(item.source);
    }
    await this.reindexItem(op, item);
  }
  private async reindexItem(op: OperationPreview, item: OperationItem) {
    if (!item.trackId) return;
    const old = this.catalog.track(item.trackId); if (!old) throw new Error('Запись трека не найдена');
    if (op.kind === 'trash') this.catalog.db.prepare('UPDATE tracks SET available=0 WHERE id=?').run(old.id);
    else {
      const lib = this.catalog.library(op.kind === 'move' ? op.targetLibraryId! : old.libraryId);
      const track = await this.workers.run<Track>('read', { file: item.destination, libraryId: lib.id, root: lib.path, id: old.id, dataDir: this.dataDir });
      this.catalog.upsert(track);
    }
  }
  async idle() { await this.pending; }
  async close() { this.stopping = true; await this.pending; await this.workers.close(); this.catalog.close(); }
}
