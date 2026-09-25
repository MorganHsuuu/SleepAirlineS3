/**
 * 在 HTTP 回應送出後繼續執行的背景工作。
 *
 * - Vercel：透過 request context 的 waitUntil，函式回應後不會被凍結，工作會跑完。
 * - 本機 `npm run dev`：Node 常駐，Promise 自然執行完畢。
 */
type VercelRequestContext = { waitUntil?: (promise: Promise<unknown>) => void };

export function runInBackground(label: string, job: () => Promise<unknown>): void {
  const task = Promise.resolve()
    .then(job)
    .catch((err) => {
      console.error(`[background] ${label} 失敗：`, err);
    });

  try {
    const holder = (globalThis as Record<PropertyKey, unknown>)[
      Symbol.for('@vercel/request-context')
    ] as { get?: () => VercelRequestContext } | undefined;
    holder?.get?.()?.waitUntil?.(task);
  } catch {
    // 沒有 waitUntil（本機）：task 已在執行，不需額外處理
  }
}
