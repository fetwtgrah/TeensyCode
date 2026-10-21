import * as z from "zod/v4";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpExpressApp } from '@modelcontextprotocol/express';

import express from "express";
import { searchWeb } from "./tools.js";
import { title } from "node:process";
// 创建 MCP Server 实例（每次请求新建，保证无状态）
const handler = createMcpHandler(() => {
const server = new McpServer({
    name: "demo-server",
    version: "v1.0.0"
  })
  server.registerTool(
    "add",
    {
      description: "把两个数字相加",
      inputSchema: z.object({
        a: z.number().describe("第一个数字"),
        b: z.number().describe("第二个数字"),
      }),
    },
    async ({ a, b }) => {
      return {
        content: [
          {
            type: "text",
            text: `结果是：${a + b}`,
          },
        ],
      };
    }
  );
  server.registerTool(
    "search",
    {
      description:"用于搜索联网内容",
      inputSchema:z.object({
        query: z.string().describe("question")
      })
    },
    async ({query})=>{
      const {results}=await searchWeb(query)
      const contents = results.map((item) => ({
        type: "text" as const,
        text: `标题：${item.title}\n链接：${item.url}\n摘要：${item.summary}\n相关度：${item.rerank_score}`,
      }));
      return {
        content:contents
      }
    }
  )
  //注册提示词
  server.registerPrompt(
    "greeter",
    {
      description: "登录之后表示欢迎",
      argsSchema: z.object({
        name: z.string().describe("用户的名字"),
        role: z.enum(["user", "admin", "visitor"]).optional(),
      }),
    },
    async ({ name, role }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `欢迎 ${name}${role}，我已准备好帮助你。`,
            },
          },
        ],
      };
    }
  );
  return server;
})
const mcpApp = createMcpExpressApp()
const nodeHandler = toNodeHandler(handler)
mcpApp.use(express.json())
mcpApp.all("/mcp", (rep, res) => nodeHandler(rep, res,rep.body))
mcpApp.listen(3000, () => {
  console.log("MCP Server 运行在 http://127.0.0.1:3000/mcp");
});
