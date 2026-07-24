export function collectionOwnsArrowKey(
  activeIndex: number,
  nativeInteractiveFocused: boolean,
): boolean {
  return activeIndex >= 0 || !nativeInteractiveFocused;
}

export function nextCollectionIndex(
  itemCount: number,
  currentIndex: number,
  delta: -1 | 1,
): number {
  if (itemCount <= 0) return -1;
  return (currentIndex + delta + itemCount) % itemCount;
}
