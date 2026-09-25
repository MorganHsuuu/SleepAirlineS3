/** 逾時後改走 fallback，避免 Vercel 504 整段失敗。 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T | Promise<T>
): Promise<T> {
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      Promise.resolve(onTimeout()).then(resolve, reject);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
