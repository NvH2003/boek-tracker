const RETRYABLE = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? (err.cause as NodeJS.ErrnoException | undefined)?.code;
  if (code && RETRYABLE.has(code)) return true;
  return err.message === "fetch failed";
}

/** Herhaal InstantDB-aanroepen bij korte netwerkstoringen (ECONNRESET). */
export async function withInstantRetry<T>(
  fn: () => Promise<T>,
  attempts = 4
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}
