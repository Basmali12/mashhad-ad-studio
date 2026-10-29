export class StudioError extends Error {
  constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; }
}
export function fail(condition, code, status = 400) { if (!condition) throw new StudioError(code, status); }
export function publicError(error, requestId) {
  return { error: { code: error instanceof StudioError ? error.code : 'INTERNAL_ERROR', requestId } };
}
