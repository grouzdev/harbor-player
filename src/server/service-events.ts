import type { Job } from "../shared/contracts.js";

export type ServiceEvent =
  | { type: "catalog" }
  | { type: "job"; job: Job }
  | { type: "operation-start"; trackIds: string[] }
  | { type: "operation-finished"; operationId: string };
