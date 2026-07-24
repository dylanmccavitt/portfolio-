export interface GuideHistoryTurn {
  generation: number;
  start: number;
}

export function beginGuideHistoryTurn<T>(
  history: T[],
  generation: number,
  message: T,
): GuideHistoryTurn {
  const turn = { generation, start: history.length };
  history.push(message);
  return turn;
}

export function rollbackGuideHistoryTurn<T>(
  history: T[],
  turn: GuideHistoryTurn,
  currentGeneration: number,
): boolean {
  if (turn.generation !== currentGeneration) return false;
  history.length = turn.start;
  return true;
}

export function completeGuideHistoryTurn<T>(
  history: T[],
  turn: GuideHistoryTurn,
  currentGeneration: number,
  message: T | null,
): boolean {
  if (turn.generation !== currentGeneration) return false;
  if (message !== null) history.push(message);
  return true;
}

export function resetGuideHistory<T>(history: T[], currentGeneration: number): number {
  history.length = 0;
  return currentGeneration + 1;
}
