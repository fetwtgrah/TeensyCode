
import "dotenv/config";
import { createServer } from "node:http";
import { agent, mcpClient } from "./client.js";

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  try {
    let body = "";

    for await (const chunk of req) {
      body += chunk.toString();
    }

    const { message } = JSON.parse(body);

    if (typeof message !== "string" || !message.trim()) {
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ error: "message 不能为空" }));
      return;
    }

  const result = await agent.generate({
      prompt: message,
    });

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({
  text: result.text,
  steps: result.steps.map((step) => ({
    toolCalls: step.toolCalls.map((call) => ({
      toolName: call.toolName,
      input: call.input,
    })),
    toolResults: step.toolResults.map((result) => ({
      toolName: result.toolName,
      output: result.output,
    })),
  })),
}));
  } catch (error) {
    console.error("Agent 请求失败：", error);

    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
    });

    res.end(JSON.stringify({
  error: error instanceof Error ? error.message : String(error),
}));
  }
});

server.listen(8787, "127.0.0.1", () => {
  console.log("Agent HTTP 服务已启动：http://127.0.0.1:8787");
});

async function shutdown() {
  server.close();
  await mcpClient?.close();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
