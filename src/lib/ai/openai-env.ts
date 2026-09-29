/** Vercel 上的變數名稱是 OPENAI_API；程式也接受標準的 OPENAI_API_KEY。 */
export function openAiApiKey(): string {
  return (process.env.OPENAI_API_KEY || process.env.OPENAI_API || '').trim();
}
