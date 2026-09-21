import type {
  FolderMoveRoot,
  Job,
  OperationKind,
  OperationPreview,
  OperationRetryResult,
  PerTrackTagPatch,
  Selection,
  TagPatch,
} from "../shared/contracts.js";

/**
 * Narrow boundary for the externally reachable lifecycle of a file operation.
 *
 * The backend deliberately exposes no catalog, worker, or filesystem details:
 * those stay behind the operation implementation while MusicService keeps queue
 * ownership and shutdown coordination.
 */
export interface OperationBackend {
  preview(
    kind: Exclude<OperationKind, "restore">,
    selection: Selection,
    targetLibraryId?: string,
    patch?: TagPatch,
    companions?: boolean,
    itemPatches?: Record<string, PerTrackTagPatch>,
    coverTrackIds?: string[],
    folderRoots?: FolderMoveRoot[],
    intent?: OperationPreview["intent"],
  ): Promise<OperationPreview>;
  previewRestore(id: string): Promise<OperationPreview>;
  previewRetry(id: string): Promise<OperationPreview>;
  execute(id: string): Job;
  operation(id: string): OperationPreview;
}

export class OperationOrchestrator {
  constructor(private readonly backend: OperationBackend) {}

  preview(...args: Parameters<OperationBackend["preview"]>) {
    return this.backend.preview(...args);
  }

  previewRestore(id: string) {
    return this.backend.previewRestore(id);
  }

  previewRetry(id: string) {
    return this.backend.previewRetry(id);
  }

  async retry(id: string): Promise<OperationRetryResult> {
    const original = this.backend.operation(id);
    // `copied` means the atomic replacement already happened. Resume only the
    // catalog reconciliation; creating another preview would write tags twice.
    if (original.kind === "tags" && original.status !== "running") {
      if (original.items.some((item) => item.phase === "copied"))
        return { action: "resume", job: this.backend.execute(id) };
      return {
        action: "preview",
        preview: await this.backend.previewRetry(id),
      };
    }
    return { action: "resume", job: this.backend.execute(id) };
  }

  execute(id: string) {
    return this.backend.execute(id);
  }
}
