export function moveReplayIndex(current: number, direction: -1 | 1, transitionCount: number) {
  return Math.max(-1, Math.min(transitionCount - 1, current + direction));
}

export function swipeReplayIndex(current: number, deltaX: number, deltaY: number, transitionCount: number) {
  if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return current;
  return moveReplayIndex(current, deltaX < 0 ? 1 : -1, transitionCount);
}
