import "dotenv/config";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { resolve } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp"
import { LocalSandBox } from "../sandbox.js";
import { CreateBashTool, CreateGrepTool, CreateReadTool, CreateWriteTool, CreateWebTool, CreateCodeTool } from "./tool.js";
import { CreateSystemPrompt } from "./system.js";
import { createAnthropic } from '@ai-sdk/anthropic';
// const packy = createAnthropic({
//   apiKey: process.env.PACKY_API_KEY!,
//   baseURL:"https://slb-v1.api.fan/v1"
// });
export const cwd = resolve(process.cwd(), "workplace")
const sandbox = new LocalSandBox(cwd)

const write = CreateWriteTool(sandbox)
const read = CreateReadTool(sandbox)
const grep = CreateGrepTool(sandbox)
const bash = CreateBashTool(sandbox)
const code_interpreter = CreateCodeTool(sandbox)

export let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;
export let WebMcpTools: ToolSet = {};

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

const webAgent = new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions: "你是一个负责互联网搜索和获取网页内容的Agent",
  tools: WebMcpTools,
  stopWhen: stepCountIs(5)

})
export type WebAgent = typeof webAgent
const webTool = CreateWebTool(webAgent)

export const Localtools = { read, grep, bash, write, webTool, code_interpreter }

const instructions = CreateSystemPrompt({
  workingDictory: cwd,
  sandBoxType: "local",
  toolName: Object.keys(Localtools)
})


export const agent = new ToolLoopAgent({
  model: deepseek("deepseek-chat"),
  instructions,
  tools: {
    ...Localtools,
  },
  stopWhen: stepCountIs(10)
})
