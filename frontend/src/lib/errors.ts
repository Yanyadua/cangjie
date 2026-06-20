/**
 * Extract a human-readable error message from a caught value.
 * Handles Error instances, axios-like response objects, and primitives.
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'response' in e) {
    const r = (e as { response?: { data?: { detail?: string } } }).response;
    if (r?.data?.detail) return r.data.detail;
  }
  return String(e);
}
