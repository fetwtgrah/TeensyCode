import type { SandBox } from "../sandbox.js";
import {tool} from "ai"
import {z} from "zod"
import { relative,resolve} from "node:path";
export function CreatReadTool(sandbox :SandBox){
    return tool({
          description: `using this tool for reading the file from the project , returns numbered lines,
          WHEN TO USE: need to check file content,
          WHEN NOT TO USE: search for specific function or pattrens(use grep instead),run commands(use bash instead)
          USAGE: path is relative to working directory. offset and limit are optional.
          Output is capped at 500 lines.
          `,
          inputSchema: z.object({
            path: z.string().describe("文件的相对路径"),
            offset: z.number().optional().describe("从第几行开始，以1作为初始"),
            limit: z.number().optional().describe("最多读取多少行")
          }),
          execute: async({path,offset,limit})=>{
            return  sandbox.readfile(path,offset,limit)
          }
    })
}
export function CreatWriteTool(sandbox:SandBox){
    return tool({
        description: `
          在工作目录中创建或写入文件。
          WHEN TO USE: 创建 Markdown、文本文件或更新文件内容。
          不要使用 bash 的 echo 命令代替文件写入。
          `,
          inputSchema: z.object({
            path: z.string().describe("相对于工作目录的文件路径"),
            content: z.string().describe("需要写入的完整文件内容"),
          }),
          execute: async({path,content})=>{
            return sandbox.writefile(path,content) 
          }
    })

}