import type { SandBox } from "../sandbox.js";
import { tool, type ModelMessage } from "ai"
import { z } from "zod"
import { relative, resolve, join, basename } from "node:path";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { WebAgent } from "./client.js";
import { MessagePrint } from "../utils/messageLog.js";
import { cwd } from "./client.js";

export function CreateWebTool(agent: WebAgent) {
  const submessages: ModelMessage[] = []
  return tool({
    description: "你是一个负责互联网搜索的Agent",
    inputSchema: z.object({
      query: z.string()
    }),
    execute: async ({ query }) => {
      submessages.push({
        role: "user",
        content: query
      })

      const result = await agent.generate({
        messages: submessages
      })
      submessages.push({
        role: "assistant",
        content: result.text
      })
      MessagePrint(submessages, cwd, "sub")
      return result.text
    }
  })
}
export function CreateCodeTool(sandbox: SandBox) {
  return tool({
    description:
      `Execute Python code and return its output and execution status.
      WHEN TO USE:need code to solve problem 
      WHEN
      
      
      `,
    inputSchema: z.object({
      code: z.string().describe("The Python code to execute"),
    }),
    execute: async ({ code }) => {
      const temp = `.code_temp.py`;
      try {
        sandbox.writefile(temp, code, false);
        const result = await sandbox.exec(
          `python "${temp}"`
        );
        return {
          stdout: result.stdout,
          exitcode: result.exitcode,
          error: result.exitcode !== 0,
        };
      } catch (error) {
        return {
          stdout: "",
          exitcode: 1,
          error: true,
          message:
            error instanceof Error ? error.message : String(error),
        };
      } finally {
        await rm(join(sandbox.workingdictory, temp), { force: true });
      }
    },
  });
}
export function CreateReadTool(sandbox: SandBox) {
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
    execute: async ({ path, offset, limit }) => {
      return sandbox.readfile(path, offset, limit)
    }
  })
}
export function CreateWriteTool(sandbox: SandBox) {
  return tool({
    description: `
          在工作目录中创建或写入文件。
          WHEN TO USE: 创建 Markdown、文本文件或更新文件内容。
          不要使用 bash 的 echo 命令代替文件写入。
          `,
    inputSchema: z.object({
      path: z.string().describe("相对于工作目录的文件路径"),
      content: z.string().describe("需要写入的完整文件内容"),
      overwrite: z.boolean().default(false).describe("文件已经存在的时候是否覆盖，默认为false"),
    }),
    execute: async ({ path, content, overwrite }) => {
      return sandbox.writefile(path, content, overwrite)
    }
  })

}
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

export function CreateGrepTool(sandbox: SandBox) {
  return tool({
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
      const dir = resolve(sandbox.workingdictory, searchPath || ".")
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
              matches.push(`${relative(sandbox.workingdictory, file)}:${i + 1}:${line[i]?.trim()}`)
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
}

export function CreateBashTool(sandbox: SandBox) {
  return tool({
    description: ` Execute a shell command in the project workspace.
            Use this tool to inspect files, check git status,
            and run project tests.
            Do not execute destructive commands.`,
    inputSchema: z.object({
      command: z.string().min(1).describe("输入你的指令")
    }),
    execute: async ({ command }) => {
      try {
        const result = await sandbox.exec(command);

        return {
          stdout: result.stdout,
          exitCode: result.exitcode,
        };
      } catch (error) {
        return {
          stdout: "",
          exitCode: 1,
          error: error instanceof Error
            ? error.message
            : String(error),
        };
      }
    }
  })
}