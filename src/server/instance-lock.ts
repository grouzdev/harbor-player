import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export function acquireInstanceLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "server.lock");
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(readFileSync(file, "utf8")).token === token)
            unlinkSync(file);
        } catch {
          /* Already removed on shutdown. */
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid: number;
      try {
        pid = JSON.parse(readFileSync(file, "utf8")).pid;
      } catch {
        throw new Error(
          `Не удалось проверить блокировку ${file}. Закройте другие экземпляры сервиса и проверьте этот файл.`,
        );
      }
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new Error(`Некорректная блокировка ${file}`);
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") {
          unlinkSync(file);
          continue;
        }
        throw e;
      }
      throw new Error(
        "MyMusicLib уже запущен с этим каталогом данных. Откройте существующее окно браузера.",
      );
    }
  }
  throw new Error("Не удалось получить блокировку каталога");
}
