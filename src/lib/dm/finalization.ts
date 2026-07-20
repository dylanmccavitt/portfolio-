/** Browser-safe v2 terminal integrity helpers shared by the server and client. */

export function v2FinalizationMarkdownsMatch(streamed: string, finalized: string): boolean {
  return normalizeV2FinalizationMarkdown(streamed) === normalizeV2FinalizationMarkdown(finalized);
}

function normalizeV2FinalizationMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && isBlankBoundaryLine(lines[first] as string)) first += 1;
  while (last >= first && isBlankBoundaryLine(lines[last] as string)) last -= 1;
  return lines.slice(first, last + 1).join('\n');
}

function isBlankBoundaryLine(line: string): boolean {
  return /^[\t ]*$/.test(line);
}
