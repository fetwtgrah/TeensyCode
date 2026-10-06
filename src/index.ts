import "dotenv/config";
import { generateText, tool, stepCountIs, type ModelMessage, ToolLoopAgent } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { readFile, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, resolve } from "node:path";
import { z } from "zod";
import { fi } from "zod/locales";

const cwd = process.argv[2] || process.cwd()

function walk(dir: string) :string[]{
  const result:string[]=[]
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) result.push(...walk(full))
    else result.push(full)
  }
  return result
}
function globToRegex(glob: string): RegExp {
  const escaped = glob
  .replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*/g,".*")
  .replace(/\?/g,".")
  return new RegExp(`${escaped}`)
}

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
    if (offset) lines = lines.slice(offset - 1)
    if (limit) lines = lines.slice(0, limit)
    const MAX_LENGTH = 500
    const ifOver = MAX_LENGTH < lines.length
    lines = (ifOver) ? lines.slice(0, MAX_LENGTH) : lines
    const numbered = lines.map((line, i) => `${(offset || 1) + i}:${line}`)
    return ifOver
      ? numbered.join("\n") + `\n目前只读到了${MAX_LENGTH}行`
      : numbered.join("\n") + `\n读取文件行数：${lines.length}，已经阅读完成`
  }
})

const grep = tool({
  description: `Search file contents for a plain text string (not a regex). Returns matching lines as "file:line:content".
WHEN TO USE: finding a keyword across multiple files, locating function names, TODOs, error messages.
WHEN NOT TO USE: reading a known file (use read instead).
DO NOT USE FOR: running commands, listing directories.
EXAMPLES:
  - Find TODO comments: pattern "TODO" glob "*.ts"
  - Find a function: pattern "function readFile" glob "*.ts"`,
  inputSchema: z.object({
    pattern: z.string().describe(`Plain text to search for (not a regex)`),
    path: z.string().optional().describe("搜索的目录，默认为工作目录"),
    glob: z.string().optional().describe("文件名过滤")
  }),
  execute: async ({pattern,path:searchPath,glob:globFilter})=>{
    const dir=resolve(cwd,searchPath||".")
    const globRe=globToRegex(globFilter||"*")
    const keyword=pattern.toLowerCase()
    const MAX_MATCHES=50
    const matches: string[]=[]
    let total=0
    let files:string[]=[]
    try{
      files=walk(dir)
    }catch{
      return `无法访问${searchPath||"."}`
    }
    for(const file of files){
      if(!globRe.test(basename(file))) continue
      let content :string
      try{
        if(statSync(file).size>1_000_000) continue
        content=readFileSync(file,"utf-8")
      }catch{
        continue
      }
      const line=content.split("\n")
      for(let i=0;i<line.length;i++){
        if(line[i]?.toLowerCase().includes(keyword)){
          total++
          if(matches.length<MAX_MATCHES){
            matches.push(`${relative(cwd,file)}:${i+1}:${line[i]?.trim()}`)
          }
        }
        
      }
    }

    if(total===0) return "没有配对内容"
    return total>MAX_MATCHES
           ?matches.join("\n")+`\n...(共有${total}条，当前只显示${MAX_MATCHES})`
          :matches.join("\n")
  }
})


const agent = new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions: `你是一个中文编程助手,工作目录为${cwd}`,
  tools: { read,grep },
  stopWhen: stepCountIs(10)
})
const prompt = process.argv.slice(3).join(" ") || "hello"
const result = await agent.generate({ prompt })
console.log(result.text)
console.log("一共执行了" + result.steps.length + "步")
