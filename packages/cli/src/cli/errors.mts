export function formatCliError(error: unknown, debug = false): string {
  if (error instanceof Error) {
    return debug ? (error.stack ?? error.message) : error.message;
  }
  return String(error);
}
