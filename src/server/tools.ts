
import 'dotenv/config';
//websearchTool
const API_KEY = process.env.DEEPSEEK_API_KEY;
const basicUrl = "https://api.deepseek.com/v1/tools"

console.log("Key prefix:", API_KEY?.slice(0, 8), "Length:", API_KEY?.length);
async function request<T>(end: string, body: Record<string, unknown>): Promise<T> {
    const reponse = await fetch(`${basicUrl}/${end}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
    })
    if (!reponse.ok) {
        const body = await reponse.text();
        throw new Error(`HTTP ${reponse.status} | ${body}`)
    }
    return (await reponse.json()) as T
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  rerank_score: number;
  authority: number;
}

export async function searchWeb(query: string) {
  return request<{ results: SearchResult[] }>("search", {
    query,
    count: 5,
    need_content: false,
  });
}

export async function fetchWeb(url: string) {
  return request<{ title: string; content: string }>(
    "fetch",
    { url },
  );
}