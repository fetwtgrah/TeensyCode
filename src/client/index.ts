import "dotenv/config";
import { tool, stepCountIs, ToolLoopAgent } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, basename, resolve, isAbsolute, sep } from "node:path";
import { z } from "zod";
import { execSync } from "node:child_process";
import { creatSystemPrompt } from "./system.js";
import { createMCPClient } from "@ai-sdk/mcp"
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { CreatReadTool, CreatWriteTool } from "./tool.js";
import { LocalSandBox } from "../sandbox.js";

const cwd = resolve(process.cwd(),"workplace")
const sandbox=new LocalSandBox(cwd)
function walk(dir: string): string[] {
  const result: string[] = []
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
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`${escaped}`)
}

const write=CreatWriteTool(sandbox)
const read =CreatReadTool(sandbox)

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
  execute: async ({ pattern, path: searchPath, glob: globFilter }) => {
    const dir = resolve(cwd, searchPath || ".")
    const globRe = globToRegex(globFilter || "*")
    const keyword = pattern.toLowerCase()
    const MAX_MATCHES = 50
    const matches: string[] = []
    let total = 0
    let files: string[] = []
    try {
      files = walk(dir)
    } catch {
      return `无法访问${searchPath || "."}`
    }
    for (const file of files) {
      if (!globRe.test(basename(file))) continue
      let content: string
      try {
        if (statSync(file).size > 1_000_000) continue
        content = readFileSync(file, "utf-8")
      } catch {
        continue
      }
      const line = content.split("\n")
      for (let i = 0; i < line.length; i++) {
        if (line[i]?.toLowerCase().includes(keyword)) {
          total++
          if (matches.length < MAX_MATCHES) {
            matches.push(`${relative(cwd, file)}:${i + 1}:${line[i]?.trim()}`)
          }
        }

      }
    }

    if (total === 0) return "没有配对内容"
    return total > MAX_MATCHES
      ? matches.join("\n") + `\n...(共有${total}条，当前只显示${MAX_MATCHES})`
      : matches.join("\n")
  }
})

const SAFE_PREFIXES: string[] = [
  "ls", "cat", "echo", "pwd", "which", "find",
  "head", "tail", "wc", "git log", "git status", "git diff"
]
type approvalConfig =
  | { mode: "interactive" }
  | { mode: "background" }
  | { mode: "delegated", trust: string[] }
function creatApproval(config: approvalConfig) {
  return ({ command }: { command: string }) => {
    if (config.mode === "background") return false
    if (config.mode === "delegated") {
      return !config.trust.some((p) => command.trim().startsWith(p))
    }
    return !SAFE_PREFIXES.some((p) => command.trim().startsWith(p))
  }


}
//使用工厂模式创建bash工具
interface BashOperation {
  exec(command: string): Promise<{
    stdout: string,
    exitCode: number
  }>
}
function CreatBashTool(
  operations: BashOperation,
  needApproval: (input: { command: string }) => boolean) {
  return tool({
    description: `Execute a shell command in the working directory.
  WHEN TO USE: running build commands, installing packages, running tests,
    git operations, directory listings.
  WHEN NOT TO USE: reading file contents (use read instead).
  Searching for patterns (use grep instead).
  DO NOT USE FOR: reading files (use read), searching code (use grep).`,
    inputSchema: z.object({
      command: z.string().describe("要执行的 shell 命令，例如 `ls -la` 或 `git status`")
    }),
    execute: async ({ command }) => {
      if (needApproval({ command })) {
        return `${command}命令错误，只有${SAFE_PREFIXES.join(",")}才能成功运行`
      }
      const { stdout } = await operations.exec(command)
      return stdout || "no output"
    }
  })
}
const localOpe: BashOperation = {
  exec: async (command) => {
    try {
      const stdout = execSync(command,
        {
          cwd,
          encoding: "utf-8",
          timeout: 30_000
        }
      )
      return {
        stdout: stdout,
        exitCode: 0
      }
    } catch (e: any) {
      return {
        stdout: `Exit ${e.status ?? 1}: ${e.stdout || e.stderr || e.message || ""}`,
        exitCode: e.status ?? 1
      }
    }
  }
}
const bash = CreatBashTool(localOpe, creatApproval({ mode: "interactive" }))


const instructions = creatSystemPrompt({
  workingDictory: cwd,
  sandBoxType: "local",
  toolName: Object.keys({ read, grep, bash,write })
})
const mcpClient = await createMCPClient({
  transport: { type: "http", url: "http://127.0.0.1:3000/mcp" },
});
console.log("√😊已经成功连接mcp......")
const Mcptools = await mcpClient.tools()//获取工具需要和server进行通信，所以使用异步
const Localtools = { read, grep, bash,write}
const agent = new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions,
  tools: {
    ...Mcptools,
    ...Localtools,
  },
  stopWhen: stepCountIs(10)
})
console.log("mcp server可用工具:", Object.keys(Mcptools).join(', ') || '无')
console.log("local 可用工具：", Object.keys(Localtools).join(",") || "无")
console.log("输入`exit`则退出")
console.log(`
┌──────────────────────────────────────────────┐
│                                              │
│   ███████╗██████╗ ███████╗███████╗██╗  ██╗   │
│   ██╔════╝██╔══██╗██╔════╝██╔════╝██║  ██║   │
│   █████╗  ██████╔╝█████╗  ███████╗███████║   │
│   ██╔══╝  ██╔══██╗██╔══╝  ╚════██║██╔══██║   │
│   ██║     ██║  ██║███████╗███████║██║  ██║   │
│   ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   │
│                                              │
└──────────────────────────────────────────────┘
`);
console.log("----------------------------------")
//创建一个交互页面
const r = readline.createInterface({ input, output })
try {
  while (1) {
    const userInput = await r.question("\nYOU>:")
    if (userInput == 'exit') break
    if (!userInput.trim()) continue
    const { text } = await agent.generate({
      prompt: userInput
    })
    console.log(`\n` + "FRESHER>:" + text);
  }
} finally {
  r.close()
  await mcpClient.close()
  console.log("\nFRESHER>:😳下次见")
}
