export function portraitWorkspaceWidth(visiblePanelCount: number) {
  return visiblePanelCount > 0 ? (visiblePanelCount + 1) * 200 : 0;
}

export function usesPortraitWorkspaceLayout(
  isPortraitWindow: boolean,
  width: number,
  visiblePanelCount: number,
) {
  return isPortraitWindow || width < portraitWorkspaceWidth(visiblePanelCount);
}
