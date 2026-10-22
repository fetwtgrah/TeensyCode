import "dotenv/config";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { resolve } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp"
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { LocalSandBox } from "../sandbox.js";
import { CreateBashTool, CreateGrepTool, CreateReadTool, CreateWriteTool, CreatWebTool } from "./tool.js";
import { CreateSystemPrompt } from "./system.js";
import { MessagePrint } from "../test/messageLog.js";

export const cwd = resolve(process.cwd(),"workplace")
const sandbox=new LocalSandBox(cwd)

const write=CreateWriteTool(sandbox)
const read =CreateReadTool(sandbox)
const grep=CreateGrepTool(sandbox)
const bash=CreateBashTool(sandbox)

let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;
let WebMcpTools: ToolSet = {};

try {
  mcpClient = await createMCPClient({
    transport: { type: "http", url: "http://127.0.0.1:3000/WebMcp" },
  });
  WebMcpTools = (await mcpClient.tools()) as ToolSet;
  console.log(` 😊已连接 MCP Server「${mcpClient.serverInfo.name} v${mcpClient.serverInfo.version}」`)
} catch (err) {
  console.error("✗ 连接 MCP Server 失败，联网搜索工具将不可用：", err instanceof Error ? err.message : err)
  console.error("请先启动 MCP Server：npm run server")
}

const webAgent=new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions:"你是一个负责互联网搜索的Agent",
  tools: WebMcpTools,
  stopWhen: stepCountIs(5)

})
export type WebAgent=typeof webAgent
const webTool=CreatWebTool(webAgent)

const Localtools = { read, grep, bash,write,webTool}

const instructions = CreateSystemPrompt({
  workingDictory: cwd,
  sandBoxType: "local",
  toolName: Object.keys(Localtools)
})



const agent = new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions,
  tools: {
    ...Localtools,
  },
  stopWhen: stepCountIs(10)
})


console.log("🧰WebMcp server可用工具:", Object.keys(WebMcpTools).join(', ') || '无')
console.log("🧰local 可用工具：", Object.keys(Localtools).join(",") || "无")
console.log("================exit退出====================")
console.log("============================================")
console.log("============================================")

const messages :any[]=[]

//一个终端交互页面
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
  await mcpClient?.close()
  console.log("\nFRESHER>:😳下次见")
  MessagePrint(messages,cwd,"agent")
}
