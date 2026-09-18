import type { Track } from "../shared/contracts.js";

export interface ReadWorkerArgs {
  file: string;
  libraryId: string;
  root: string;
  id: string;
  dataDir: string;
}
export interface HashWorkerArgs {
  file: string;
}
export interface WorkerTaskMap {
  read: { args: ReadWorkerArgs; result: Track };
  hash: { args: HashWorkerArgs; result: string };
}
export type WorkerTask = keyof WorkerTaskMap;
export type WorkerRequest = {
  [Task in WorkerTask]: {
    id: number;
    task: Task;
    args: WorkerTaskMap[Task]["args"];
  };
}[WorkerTask];
export type WorkerResponse =
  { id: number; result: Track | string } | { id: number; error: string };
