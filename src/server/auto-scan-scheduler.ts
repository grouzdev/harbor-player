import type { ScanSettings } from "../shared/scan-settings.js";
import { readScanSettings, writeScanSettings } from "./scan-settings.js";
import type { MusicService } from "./service.js";

export class AutoScanScheduler {
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly service: MusicService) {}

  async start(): Promise<void> {
    this.schedule(await readScanSettings(this.service.dataDir));
  }

  async update(settings: ScanSettings): Promise<ScanSettings> {
    const saved = await writeScanSettings(this.service.dataDir, settings);
    this.schedule(saved);
    return saved;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private schedule(settings: ScanSettings): void {
    this.stop();
    if (!settings.autoScanIntervalMinutes) return;
    this.scanAll();
    this.timer = setInterval(
      () => this.scanAll(),
      settings.autoScanIntervalMinutes * 60 * 1000,
    );
    this.timer.unref();
  }

  private scanAll(): void {
    for (const library of this.service.catalog.libraries()) {
      try {
        this.service.scan(library.id);
      } catch {
        // Shutdown rejects new jobs; the next start rebuilds the schedule.
      }
    }
  }
}
