export function selectFacetValue(
  values: string[],
  value: string,
  additive: boolean,
) {
  if (!additive) return [value];
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}
