import "dotenv/config";
import { generateText, tool, stepCountIs, type ModelMessage, ToolLoopAgent } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const cwd = process.argv[2] || process.cwd()
const read = tool({
  description: `使用这个工具，当需要读取文件内容的时候`,
  inputSchema: z.object({
    path: z.string().describe("文件的相对路径"),
    offset: z.number().optional().describe("从第几行开始，以1作为初始"),
    limit: z.number().optional().describe("最多读取多少行")
  }),
  execute: async ({ path: filePath, offset, limit }) => {
    const abs = resolve(cwd, filePath)
    let content: string
    try {
      content = readFileSync(abs, "utf-8")
    } catch {
        return `找不到文件${filePath}`
    }
    let lines = content.split("\n")
    if (offset) lines=lines.slice(offset - 1)
    if (limit) lines=lines.slice(0, limit)
    const MAX_LENGTH = 500
    const ifOver=MAX_LENGTH < lines.length
    lines = (ifOver) ? lines.slice(0, MAX_LENGTH) : lines
    const numbered=lines.map((line,i)=>`${(offset||1)+i}:${line}`)
    return ifOver
      ?numbered.join("\n")+`\n目前只读到了${MAX_LENGTH}行`
      :numbered.join("\n")+`\n读取文件行数：${lines.length}，已经阅读完成`
  }
})
const agent = new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions: `你是一个中文编程助手,工作目录为${cwd}`,
  tools: {read},
  stopWhen: stepCountIs(10)
})
const prompt = process.argv.slice(3).join(" ") || "hello"
const result = await agent.generate({ prompt })
console.log(result.text)
console.log("一共执行了" + result.steps.length + "步")
