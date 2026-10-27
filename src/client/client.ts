import "dotenv/config";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { resolve } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp"
import { LocalSandBox } from "../sandbox.js";
import * as tools from "./tools/toolFactory.js";
import { CreateSystemPrompt } from "./system.js";
// import { createAnthropic } from '@ai-sdk/anthropic';
// const packy = createAnthropic({
//   apiKey: process.env.PACKY_API_KEY!,
//   baseURL:"https://slb-v1.api.fan/v1"
// });
export const cwd = resolve(process.cwd(), "workplace")
const sandbox = new LocalSandBox(cwd)

const write = tools.CreateWriteTool(sandbox)
const read = tools.CreateReadTool(sandbox)
const grep = tools.CreateGrepTool(sandbox)
const bash = tools.CreateBashTool(sandbox)
const glob = tools.CreateGlobTool(sandbox)
const edit = tools.CreateEditTool(sandbox)
const code_interpreter = tools.CreateCodeTool(sandbox)

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
const websubAgent = tools.CreateWebSubAgent(webAgent)

export const Localtools = {}


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
function CreateWriteTool(sandbox: LocalSandBox) {
  throw new Error("Function not implemented.");
}

