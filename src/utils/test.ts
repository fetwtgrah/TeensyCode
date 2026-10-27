
import { searchWeb, fetchWeb } from "../server/tools.js";

async function main() {
  const { results } = await searchWeb(
    "Vercel AI SDK ToolLoopAgent site:ai-sdk.dev",
  );

  console.log("搜索结果：");
  console.log(results);

  if (results.length === 0) {
    console.log("没有找到结果");
    return;
  }

  const firstResult = results[0];
  if (!firstResult) {
    console.log("没有找到结果");
    return;
  }

  const page = await fetchWeb(firstResult.url);

  console.log("网页标题：", page.title);
  console.log("网页正文：");
  console.log(page.content.slice(0, 3000));
}

main().catch(console.error);
