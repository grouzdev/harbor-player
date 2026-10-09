import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PulseStore } from "./pulse.js";
import { badRequest } from "./http-error.js";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );
const range = z.object({ from: day, to: day }).strict();
function checkedRange(input: unknown, maxDays: number) {
  const value = range.parse(input);
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000 + 1;
  if (days < 1 || days > maxDays)
    throw badRequest(`Диапазон должен быть от 1 до ${maxDays} дней`);
  return value;
}
export function registerPulseRoutes(app: FastifyInstance, pulse: PulseStore) {
  app.get("/api/pulse/settings", async () => pulse.settings());
  app.patch("/api/pulse/settings", async (request) =>
    pulse.updateSettings(request.body),
  );
  app.post(
    "/api/listening-events",
    { bodyLimit: 1024 * 1024 },
    async (request) => pulse.ingest(request.body),
  );
  app.post("/api/pulse/clear", async (request) => {
    const body = z
      .object({
        confirm: z.literal(true),
        historyGeneration: z.number().int().min(1),
      })
      .strict()
      .parse(request.body);
    return pulse.clear(body.historyGeneration);
  });
  app.get("/api/pulse/history-range", async () => pulse.range());
  app.get("/api/pulse/layout", async (request) => {
    const { from, to } = checkedRange(request.query, 366);
    return pulse.layout(from, to);
  });
  app.get("/api/pulse/window", async (request) => {
    const { from, to } = checkedRange(request.query, 31);
    return pulse.window(from, to);
  });
  app.get("/api/pulse/days/:day/albums", async (request) => {
    const dayKey = z.object({ day }).parse(request.params).day;
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        cursor: z.string().max(2000).optional(),
      })
      .strict()
      .parse(request.query);
    if (query.cursor && query.offset)
      throw badRequest("Выберите курсор или offset");
    return pulse.dayAlbums(dayKey, query.limit, query.cursor, query.offset);
  });
  app.get("/api/pulse/albums/:id/stats", async (request) => {
    const { id } = z
      .object({ id: z.string().min(1).max(500) })
      .parse(request.params);
    const query = z
      .object({ day: day.optional() })
      .strict()
      .parse(request.query);
    return pulse.albumStats(id, query.day);
  });
}
