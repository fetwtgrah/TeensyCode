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

const cwd = resolve(process.cwd(),"workplace")
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
const write = tool({
  description: `
  在工作目录中创建或写入文件。
  WHEN TO USE: 创建 Markdown、文本文件或更新文件内容。
  不要使用 bash 的 echo 命令代替文件写入。
  `,
  inputSchema: z.object({
    path: z.string().describe("相对于工作目录的文件路径"),
    content: z.string().describe("需要写入的完整文件内容"),
  }),
  execute: async ({ path: filePath, content }) => {
    const abs = resolve(cwd, filePath);
    const rel = relative(cwd, abs);
    // 禁止访问工作目录以外的路径
    if (
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel)
    ) {
      return "拒绝写入：文件路径超出工作目录";
    }

    try {
      writeFileSync(abs, content, {
        encoding: "utf-8",
        flag: "wx",
      });

      return `文件创建成功：${rel}`;
    } catch (e: any) {
      if (e.code === "EEXIST") {
        return "文件已经存在，为避免覆盖，本次没有写入";
      }

      return `文件创建失败：${e.message}`;
    }
  },
});
const read = tool({
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
const Localtools = { read, grep, bash }
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
