export async function waitFor<T>(
  fn: () => T | Promise<T>,
  timeoutMs = 2000,
  intervalMs = 25,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() > deadline) {
      const reason = lastError instanceof Error ? `: ${lastError.message}` : '';
      throw new Error(`waitFor timed out after ${timeoutMs}ms${reason}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
