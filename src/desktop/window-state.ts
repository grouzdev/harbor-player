import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const boundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(900).max(32000),
  height: z.number().int().min(640).max(32000),
});
const stateSchema = z.object({ bounds: boundsSchema, maximized: z.boolean() });
export type WindowState = z.infer<typeof stateSchema>;
type Bounds = WindowState["bounds"];

export function fitWindowBounds(bounds: Bounds, workArea: Bounds): Bounds {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    width,
    height,
    x: Math.max(
      workArea.x,
      Math.min(bounds.x, workArea.x + workArea.width - width),
    ),
    y: Math.max(
      workArea.y,
      Math.min(bounds.y, workArea.y + workArea.height - height),
    ),
  };
}

export function windowStateStore(directory: string) {
  const file = path.join(directory, "window-state.json");
  return {
    get(): WindowState | undefined {
      try {
        return stateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        return undefined;
      }
    },
    set(state: WindowState) {
      const value = stateSchema.parse(state);
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
  };
}
