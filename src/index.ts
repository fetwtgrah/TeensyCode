import "dotenv/config";
import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { deepseek } from "@ai-sdk/deepseek"; // 换成 deepseek
import { z } from "zod";

const tools={
  search :tool({
    description:"当你需要搜索信息的时候调用这个工具",
    inputSchema:z.object({
      query: z.string().describe("需要搜索的问题")
    }),
    execute: async({query})=>{
      console.log(`正在搜索问题：${query}`)
            const results: Record<string, string> = {
        "typescript":
          "TypeScript 5.7 released in 2025. Features include improved inference, decorator metadata, and faster compilation.",
        "ai agents":
          "AI agents market projected to reach $50B by 2030. Key frameworks: Vercel AI SDK, LangChain, CrewAI.",
        "react pattern":
          "ReAct (Reasoning + Acting) proposed by Yao et al. 2022. Combines chain-of-thought with tool use for grounded reasoning.",
      };
       const key = Object.keys(results).find((k) =>
        query.toLowerCase().includes(k)
      );
      return key
        ? results[key]
        : `No specific results for "${query}". Try a more specific query.`;
    }
  }),
}
async function agentloop(userPrompt:string,maxstep:number=10) {
  const messages:ModelMessage[]=[
    {role:"user",content:userPrompt}
  ]
  console.log(`\nagent开始启动......`)
  for(let step=0;step<maxstep;step++){
    console.log(`正在执行---${step+1}步---`)
    const result=await generateText({
      model:deepseek("deepseek-chat"),
      instructions:"你是一个中文助手",
      messages,
      tools
    })
    messages.push(...result.response.messages)
    if(result.toolCalls.length===0){
      console.log(`agentloop结束,一共执行了${step+1}轮`)
      console.log(result.text)
      return result.text
    }
    for(const toolcall of result.toolCalls){
      console.log(`调用工具${toolcall.toolName}`)
    }
  } 
   return "已达到最大步数，未能得到最终答案。";
}
await agentloop("什么是ai agents")