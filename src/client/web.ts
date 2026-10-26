import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ModelMessage } from "ai";
import { agent, cwd, mcpClient } from "./client.js";
import { MessagePrint } from "../test/messageLog.js";

const FRONTEND = resolve(process.cwd(), "frontend");
const MAX_BODY = 100_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_PREVIEW_LINES = 500;
const TOOL_OUTPUT_LIMIT = 800;
const REQUEST_TIMEOUT_MS = 8 * 60 * 1000;

const sessions = new Map<string, ModelMessage[]>();
let agentBusy = false;

const staticFiles: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/style.css": "style.css",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function clip(value: unknown): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= TOOL_OUTPUT_LIMIT) return text;
  return `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n…`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > MAX_BODY) {
      throw new Error("请求体过大");
    }
  }
  return body;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function toPosix(rel: string): string {
  return rel.split(sep).join("/");
}

async function resolveInside(input: string): Promise<{ abs: string } | { error: "escape" | "missing" }> {
  const abs = resolve(cwd, input || ".");
  if (!isInside(cwd, abs)) return { error: "escape" };
  try {
    const real = await realpath(abs);
    if (!isInside(cwd, real)) return { error: "escape" };
    return { abs: real };
  } catch {
    return { error: "missing" };
  }
}

function numberedPreview(content: string): { text: string; truncated: boolean } {
  let lines = content.split("\n");
  const truncated = lines.length > MAX_PREVIEW_LINES;
  if (truncated) lines = lines.slice(0, MAX_PREVIEW_LINES);
  const text = lines.map((line, index) => `${index + 1}:${line}`).join("\n");
  return {
    text: truncated ? `${text}\n目前只读到了${MAX_PREVIEW_LINES}行` : text,
    truncated,
  };
}

async function handleFiles(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "只支持 GET" });
    return;
  }
  const requested = url.searchParams.get("path") ?? "";
  const located = await resolveInside(requested);
  if ("error" in located) {
    sendJson(res, located.error === "escape" ? 400 : 404, {
      error: located.error === "escape" ? "路径超出工作目录" : "找不到文件",
    });
    return;
  }

  const info = await stat(located.abs);
  const rel = toPosix(relative(cwd, located.abs));
  if (info.isDirectory()) {
    const entries = await readdir(located.abs, { withFileTypes: true });
    const listed = entries
      .map((entry) => ({
        name: entry.name,
        path: rel ? `${rel}/${entry.name}` : entry.name,
        type: entry.isDirectory() ? "dir" as const : "file" as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    sendJson(res, 200, { type: "dir", path: rel, entries: listed });
    return;
  }

  if (!info.isFile()) {
    sendJson(res, 400, { error: "无法预览该路径" });
    return;
  }
  if (info.size > MAX_FILE_BYTES) {
    sendJson(res, 413, { error: "文件超过 1MB，无法预览" });
    return;
  }
  const raw = await readFile(located.abs);
  if (raw.includes(0)) {
    sendJson(res, 200, {
      type: "file",
      path: rel,
      content: "二进制文件，无法预览",
      truncated: false,
    });
    return;
  }
  const preview = numberedPreview(raw.toString("utf-8"));
  sendJson(res, 200, {
    type: "file",
    path: rel,
    content: preview.text,
    truncated: preview.truncated,
  });
}

async function handleStatic(res: ServerResponse, pathname: string) {
  const name = staticFiles[pathname];
  if (!name) {
    sendJson(res, 404, { error: "Not Found" });
    return;
  }
  const filePath = resolve(FRONTEND, name);
  const bytes = await readFile(filePath);
  const mime = extname(name) === ".css"
    ? "text/css; charset=utf-8"
    : extname(name) === ".js"
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": bytes.length,
    "Cache-Control": "no-cache",
  });
  res.end(bytes);
}

function sessionIdFrom(raw: unknown): string {
  if (typeof raw === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(raw)) return raw;
  return randomUUID();
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "只支持 POST" });
    return;
  }
  if (agentBusy) {
    sendJson(res, 409, { error: "已有对话正在生成，请稍后再试" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { error: errorText(error) === "请求体过大" ? "请求体过大" : "请求体不是合法 JSON" });
    return;
  }
  if (typeof payload !== "object" || payload === null) {
    sendJson(res, 400, { error: "请求体不是对象" });
    return;
  }
  const message = "message" in payload ? payload.message : undefined;
  if (typeof message !== "string" || !message.trim()) {
    sendJson(res, 400, { error: "message 不能为空" });
    return;
  }

  const sessionId = sessionIdFrom("sessionId" in payload ? payload.sessionId : undefined);
  const prior = sessions.get(sessionId) ?? [];
  const messages: ModelMessage[] = [...prior, { role: "user", content: message }];

  agentBusy = true;
  const abort = new AbortController();
  let abortReason = "客户端已断开";
  const timer = setTimeout(() => {
    abortReason = "请求超时";
    abort.abort();
  }, REQUEST_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  writeSse(res, "session", { sessionId });

  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  let settled = false;
  const fail = (text: string) => {
    if (settled || res.writableEnded) return;
    writeSse(res, "error", { error: text });
    settled = true;
  };

  try {
    const result = await agent.stream({
      messages,
      abortSignal: abort.signal,
    });
    let text = "";
    let failed = false;
    for await (const part of result.stream) {
      if (abort.signal.aborted || res.writableEnded) break;
      if (part.type === "text-delta") {
        text += part.text;
        writeSse(res, "text", { delta: part.text });
      } else if (part.type === "tool-call") {
        writeSse(res, "tool", {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: part.input,
        });
      } else if (part.type === "tool-result") {
        writeSse(res, "tool-result", {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          output: clip(part.output),
        });
      } else if (part.type === "tool-error") {
        writeSse(res, "tool-result", {
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          output: clip(part.error),
          error: true,
        });
      } else if (part.type === "error") {
        failed = true;
        fail(errorText(part.error));
      }
    }

    if (abort.signal.aborted) {
      fail(abortReason);
      return;
    }
    if (failed || settled) return;

    const responseMessages = await result.responseMessages;
    const updated = [...messages, ...responseMessages];
    sessions.set(sessionId, updated);
    try {
      await MessagePrint(updated, cwd, "agent");
    } catch (error) {
      console.error("写入对话日志失败：", error);
    }
    if (!settled && !res.writableEnded) {
      writeSse(res, "done", { text });
      settled = true;
    }
  } catch (error) {
    if (abort.signal.aborted) {
      fail(abortReason);
    } else {
      console.error("Agent 请求失败：", error);
      fail(errorText(error));
    }
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    agentBusy = false;
    if (!res.writableEnded) res.end();
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === "/api/status") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "只支持 GET" });
      return;
    }
    sendJson(res, 200, { mcp: Boolean(mcpClient) });
    return;
  }
  if (url.pathname === "/api/files") {
    await handleFiles(req, res, url);
    return;
  }
  if (url.pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 404, { error: "Not Found" });
    return;
  }
  await handleStatic(res, url.pathname);
}

const server = createServer((req, res) => {
  void handle(req, res).catch((error) => {
    console.error("HTTP 处理失败：", error);
    if (res.headersSent) {
      if (!res.writableEnded) {
        writeSse(res, "error", { error: errorText(error) });
        res.end();
      }
      return;
    }
    sendJson(res, 500, { error: errorText(error) });
  });
});

server.requestTimeout = 0;
server.timeout = 0;

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
