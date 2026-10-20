import "dotenv/config";
import { stepCountIs, ToolLoopAgent } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { resolve } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp"
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { LocalSandBox } from "../sandbox.js";
import { CreateBashTool, CreateGrepTool, CreateReadTool, CreateWriteTool, CreatTaskTool } from "./tool.js";
import { CreateSystemPrompt } from "./system.js";
import { MessagePrint } from "../test/messageLog.js";

const cwd = resolve(process.cwd(),"workplace")
const sandbox=new LocalSandBox(cwd)

const write=CreateWriteTool(sandbox)
const read =CreateReadTool(sandbox)
const grep=CreateGrepTool(sandbox)
const bash=CreateBashTool(sandbox)

const explorer=new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions:"你是代码调查 Agent，只负责读取和分析代码。",
  tools:{read,grep},
  stopWhen: stepCountIs(5)
})
export type ExplorerAgent=typeof explorer
const task=CreatTaskTool(explorer)

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
const Localtools = { read, grep, bash,write,task}
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
const messages :any[]=[]

//创建一个交互页面
const r = readline.createInterface({ input, output })
try {
  while (1) {
    const userInput = await r.question("\nYOU>:")
    if (userInput == 'exit') break
    if (!userInput.trim()) continue
    messages.push({role:"user",content:[{
      type:"text",
      text:userInput
    }]})
    const result = await agent.generate({
      messages:messages
    })

     if (result.responseMessages) {
       messages.push(...result.responseMessages);
    }
    console.log(`\n` + "FRESHER>:" + result.text);

  }
} finally {
  r.close()
  await mcpClient.close()
  console.log("\nFRESHER>:😳下次见")
  MessagePrint(messages,cwd)
}
