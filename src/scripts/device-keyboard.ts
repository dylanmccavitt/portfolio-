export function collectionOwnsArrowKey(
  activeIndex: number,
  nativeInteractiveFocused: boolean,
): boolean {
  return activeIndex >= 0 || !nativeInteractiveFocused;
}
