// Format any thrown value into a user-readable string.
// Supabase's PostgrestError is a plain object (not an Error instance), so
// `err instanceof Error` misses it. We pull the most informative fields we
// can find: message, code, details, hint.
export function formatError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
    };
    const parts: string[] = [];
    if (e.message) parts.push(e.message);
    if (e.code) parts.push(`(code: ${e.code})`);
    if (e.details) parts.push(e.details);
    if (e.hint) parts.push(`hint: ${e.hint}`);
    if (parts.length) return parts.join(' · ');
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
