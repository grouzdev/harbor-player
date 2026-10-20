/** Shared surface controls for every workspace mode. */
export type AppearanceSurfaceSettings = {
  surfaceTransparency: number;
  backgroundBlur: number;
};

export const defaultSurfaceSettings: AppearanceSurfaceSettings = {
  surfaceTransparency: 20,
  backgroundBlur: 14,
};

export function normalizeSurfaceSettings(
  value: Partial<AppearanceSurfaceSettings>,
): AppearanceSurfaceSettings {
  const valid = (value: unknown, maximum: number, fallback: number) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maximum
      ? value
      : fallback;
  return {
    surfaceTransparency: valid(
      value.surfaceTransparency,
      100,
      defaultSurfaceSettings.surfaceTransparency,
    ),
    backgroundBlur: valid(
      value.backgroundBlur,
      40,
      defaultSurfaceSettings.backgroundBlur,
    ),
  };
}
