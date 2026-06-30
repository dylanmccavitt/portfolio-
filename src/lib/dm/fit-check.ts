export const FIT_CHECK_INPUT_LIMIT = 12000;
export const FIT_CHECK_CONTEXT_LIMIT = 7000;
export const FIT_CHECK_MIN_CHARS = 120;
export const FIT_CHECK_REQUEST_BODY_LIMIT = 64000;

export interface SanitizedFitCheckInput {
  jobDescription: string;
  originalLength: number;
  truncated: boolean;
}

export function sanitizeJobDescriptionForFitCheck(input: string): SanitizedFitCheckInput {
  const originalLength = input.length;
  const cleaned = input
    .replace(/\r\n?/g, '\n')
    .split('')
    .map((char) => (isUnsafeControlCharacter(char) ? ' ' : char))
    .join('')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone removed]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= FIT_CHECK_CONTEXT_LIMIT) {
    return {
      jobDescription: cleaned,
      originalLength,
      truncated: originalLength !== cleaned.length,
    };
  }

  return {
    jobDescription: truncateAtWordBoundary(cleaned, FIT_CHECK_CONTEXT_LIMIT),
    originalLength,
    truncated: true,
  };
}

export function fitCheckValidationMessage(input: string): string | null {
  const trimmedLength = input.trim().length;
  if (trimmedLength < FIT_CHECK_MIN_CHARS) {
    return `Paste at least ${FIT_CHECK_MIN_CHARS.toLocaleString()} characters from the job description.`;
  }
  if (input.length > FIT_CHECK_INPUT_LIMIT) {
    return `Paste ${FIT_CHECK_INPUT_LIMIT.toLocaleString()} characters or fewer.`;
  }
  return null;
}

function isUnsafeControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code === 0x7f || (code < 0x20 && char !== '\n' && char !== '\t');
}

function truncateAtWordBoundary(value: string, limit: number): string {
  const slice = value.slice(0, limit);
  const boundary = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
  if (boundary < limit * 0.85) return slice.trim();
  return slice.slice(0, boundary).trim();
}
