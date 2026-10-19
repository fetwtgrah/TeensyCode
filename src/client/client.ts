import "dotenv/config";
import { tool, stepCountIs, ToolLoopAgent } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { join, relative, basename, resolve, isAbsolute, sep } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp"
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { LocalSandBox } from "../sandbox.js";
import { CreateBashTool, CreateGrepTool, CreateReadTool, CreateWriteTool } from "./tool.js";
import { CreateSystemPrompt } from "./system.js";

const cwd = resolve(process.cwd(),"workplace")
const sandbox=new LocalSandBox(cwd)

const write=CreateWriteTool(sandbox)
const read =CreateReadTool(sandbox)
const grep=CreateGrepTool(sandbox)
const bash=CreateBashTool(sandbox)

const instructions = CreateSystemPrompt({
  workingDictory: cwd,
  sandBoxType: "local",
  toolName: Object.keys({ read, grep, bash,write })
})
const mcpClient = await createMCPClient({
  transport: { type: "http", url: "http://127.0.0.1:3000/mcp" },
});
console.log("√😊已经成功连接mcp......")
const Mcptools = await mcpClient.tools()
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
