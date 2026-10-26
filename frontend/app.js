const transcript = document.querySelector("#transcript");
const empty = document.querySelector("#empty");
const input = document.querySelector("#input");
const send = document.querySelector("#send");
const form = document.querySelector("#composer");
const banner = document.querySelector("#banner");
const mcpStatus = document.querySelector("#mcp-status");
const mcpLabel = document.querySelector("#mcp-label");
const runStatus = document.querySelector("#run-status");
const tree = document.querySelector("#tree");
const preview = document.querySelector("#preview");
const previewPath = document.querySelector("#preview-path");
const previewBody = document.querySelector("#preview-body");
const previewCopy = document.querySelector("#preview-copy");
const layout = document.querySelector(".layout");
const scrollBottom = document.querySelector("#scroll-bottom");

let sessionId = null;
let busy = false;
let inflight = null;
let selectedPath = "";
let turn = 0;
const expanded = new Set();

/* ---------- 图标与文件类型 ---------- */
const svgFolder = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const svgFile = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

const FILE_COLORS = {
  js: "#eab308", mjs: "#eab308", cjs: "#eab308",
  ts: "#2f74c0", tsx: "#2f74c0", jsx: "#22d3ee",
  html: "#ea580c", htm: "#ea580c", css: "#2563eb",
  scss: "#c26fd1", less: "#1d4ed8", json: "#65a30d",
  md: "#0ea5e9", txt: "#94a3b8", log: "#94a3b8",
  py: "#3572A5", c: "#a8b9cc", cpp: "#f34b7d", h: "#a8b9cc", hpp: "#f34b7d",
  sh: "#4d5a5e", yml: "#6b7280", yaml: "#6b7280", png: "#a78bfa", jpg: "#a78bfa",
};

function fileIconFor(name) {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const color = FILE_COLORS[ext] || "var(--faint)";
  return `<span class="tree-icon" style="color:${color}">${svgFile}</span>`;
}

/* ---------- Markdown 渲染 ---------- */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  return s;
}

function codeBlockHtml(code, lang) {
  return `<div class="codeblock"><div class="codeblock-head"><span>${escapeHtml(lang || "代码")}</span><button type="button" class="copy-btn">复制</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
}

function renderMarkdown(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(codeBlockHtml(buf.join("\n"), fence[1]));
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      const level = (line.match(/^#+/) || [""])[0].length;
      out.push(`<h${level}>${inlineMarkdown(line.replace(/^#+\s+/, ""))}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${buf.map(inlineMarkdown).join("<br>")}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${buf.map(inlineMarkdown).join("<br>")}</p>`);
  }
  return out.join("");
}

/* ---------- 界面辅助 ---------- */
function setBanner(text) {
  if (!text) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = text;
}

function setBusy(next, label) {
  busy = next;
  input.disabled = next;
  send.textContent = next ? "停止" : "发送";
  send.classList.toggle("danger", next);
  runStatus.textContent = label || "";
}

function nearBottom() {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 90;
}

function stick() {
  if (nearBottom()) transcript.scrollTop = transcript.scrollHeight;
  updateScrollButton();
}

function updateScrollButton() {
  scrollBottom.classList.toggle("show", !nearBottom());
}

function hideEmpty() {
  if (empty) empty.hidden = true;
}

function showEmpty() {
  if (empty) empty.hidden = false;
}

function removeTyping(assistant) {
  if (assistant.typing) {
    assistant.typing.remove();
    assistant.typing = null;
  }
}

function addMessage(role, text) {
  hideEmpty();
  const article = document.createElement("article");
  article.className = `msg ${role}`;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "你" : "Agent";
  const stream = document.createElement("div");
  stream.className = "stream";

  let body = null;
  let typing = null;
  if (text) {
    body = document.createElement("div");
    body.className = "body";
    if (role === "assistant") body.innerHTML = renderMarkdown(text);
    else body.textContent = text;
    stream.append(body);
  } else if (role === "assistant") {
    body = document.createElement("div");
    body.className = "body";
    stream.append(body);
    typing = document.createElement("div");
    typing.className = "typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    stream.append(typing);
  }

  article.append(who, stream);
  transcript.append(article);
  stick();
  return { article, stream, tools: new Map(), text: text || "", body, typing };
}

function appendDelta(assistant, delta) {
  assistant.text += delta;
  removeTyping(assistant);
  if (assistant.body) assistant.body.innerHTML = renderMarkdown(assistant.text);
  stick();
}

function ensureBody(assistant, text) {
  if (assistant.text) return;
  assistant.text = text;
  removeTyping(assistant);
  if (assistant.body) assistant.body.innerHTML = renderMarkdown(text);
}

function toolNode(call) {
  const details = document.createElement("details");
  details.className = "tool";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = call.toolName;
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(call.input, null, 2);
  const output = document.createElement("pre");
  output.className = "tool-output";
  output.hidden = true;
  details.append(summary, pre, output);
  return { details, summary, output };
}

/* ---------- 状态与文件树 ---------- */
async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    mcpLabel.textContent = data.mcp ? "联网可用" : "联网不可用";
    mcpStatus.classList.toggle("ok", Boolean(data.mcp));
    mcpStatus.classList.toggle("off", !data.mcp);
  } catch {
    mcpLabel.textContent = "状态未知";
    mcpStatus.classList.add("off");
    mcpStatus.classList.remove("ok");
  }
}

function fileButton(entry, depth) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-item ${entry.type}`;
  button.style.paddingLeft = `${6 + depth * 14}px`;
  button.dataset.path = entry.path;

  if (entry.type === "dir") {
    const chevron = document.createElement("span");
    chevron.className = "chevron" + (expanded.has(entry.path) ? " open" : "");
    chevron.textContent = "▸";
    const icon = document.createElement("span");
    icon.className = "tree-icon";
    icon.style.color = "var(--accent)";
    icon.innerHTML = svgFolder;
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entry.name;
    button.append(chevron, icon, label);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "chevron";
    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entry.name;
    button.append(spacer);
    button.insertAdjacentHTML("beforeend", fileIconFor(entry.name));
    button.append(label);
  }

  if (entry.path === selectedPath) button.classList.add("selected");
  return button;
}

async function renderDir(path, container, depth) {
  container.replaceChildren();
  const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  const data = await response.json();
  if (!response.ok) {
    const note = document.createElement("p");
    note.className = "tree-note";
    note.textContent = data.error || "无法读取目录";
    container.append(note);
    return;
  }
  if (!data.entries.length) {
    const note = document.createElement("p");
    note.className = "tree-note";
    note.textContent = "空目录";
    container.append(note);
    return;
  }
  for (const entry of data.entries) {
    const row = document.createElement("div");
    const button = fileButton(entry, depth);
    row.append(button);
    if (entry.type === "dir") {
      const child = document.createElement("div");
      child.className = "tree-children";
      child.hidden = !expanded.has(entry.path);
      button.addEventListener("click", async () => {
        const chevron = button.querySelector(".chevron");
        if (expanded.has(entry.path)) {
          expanded.delete(entry.path);
          child.hidden = true;
          chevron.classList.remove("open");
        } else {
          expanded.add(entry.path);
          child.hidden = false;
          chevron.classList.add("open");
          await renderDir(entry.path, child, depth + 1);
        }
      });
      row.append(child);
      if (expanded.has(entry.path)) {
        await renderDir(entry.path, child, depth + 1);
      }
    } else {
      button.addEventListener("click", () => openFile(entry.path, button));
    }
    container.append(row);
  }
}

async function loadTree() {
  tree.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "tree-note";
  loading.textContent = "读取中…";
  tree.append(loading);
  await renderDir("", tree, 0);
}

async function openFile(path, button) {
  selectedPath = path;
  for (const item of tree.querySelectorAll(".tree-item")) {
    item.classList.toggle("selected", item.dataset.path === path);
  }
  preview.hidden = false;
  layout.classList.add("show-preview");
  previewPath.textContent = path;
  previewBody.textContent = "读取中…";
  const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  const data = await response.json();
  previewBody.textContent = response.ok ? data.content : (data.error || "无法预览");
  if (button) button.classList.add("selected");
}

function resetChat() {
  turn += 1;
  inflight?.abort();
  inflight = null;
  sessionId = null;
  setBusy(false, "");
  setBanner("");
  transcript.querySelectorAll(".msg").forEach((node) => node.remove());
  showEmpty();
  input.focus();
}

/* ---------- SSE ---------- */
async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = "message";
      const dataLines = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) onEvent(event, JSON.parse(dataLines.join("\n")));
      split = buffer.indexOf("\n\n");
    }
  }
}

/* ---------- 发送消息 ---------- */
async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || busy) return;
  const myTurn = ++turn;
  input.value = "";
  autosize();
  setBanner("");
  addMessage("user", trimmed);
  const assistant = addMessage("assistant", "");
  setBusy(true, "思考中");
  const controller = new AbortController();
  inflight = controller;
  const current = () => myTurn === turn;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: trimmed,
        ...(sessionId ? { sessionId } : {}),
      }),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
      const data = await response.json().catch(() => ({ error: "请求失败" }));
      throw new Error(data.error || "请求失败");
    }
    await readSse(response, (event, data) => {
      if (!current()) return;
      if (event === "session" && data.sessionId) sessionId = data.sessionId;
      if (event === "text") {
        appendDelta(assistant, data.delta || "");
        setBusy(true, "回复中");
      }
      if (event === "tool") {
        removeTyping(assistant);
        const node = toolNode(data);
        assistant.stream.append(node.details);
        assistant.tools.set(data.toolCallId || data.toolName, node);
        setBusy(true, `执行 ${data.toolName}`);
        stick();
      }
      if (event === "tool-result") {
        const node = assistant.tools.get(data.toolCallId || data.toolName);
        if (node) {
          node.summary.textContent = data.error ? `${data.toolName} 失败` : `${data.toolName} 完成`;
          node.output.hidden = false;
          node.output.textContent = data.output || "";
          node.details.classList.toggle("failed", Boolean(data.error));
        }
        stick();
      }
      if (event === "error") {
        ensureBody(assistant, data.error || "生成失败");
        setBanner(data.error || "生成失败");
      }
      if (event === "done") ensureBody(assistant, data.text || "");
    });
    if (!current()) return;
    if (!assistant.text && !banner.textContent) {
      ensureBody(assistant, "这一轮没有文本回复。");
    }
    removeTyping(assistant);
    await loadTree();
    if (selectedPath) await openFile(selectedPath);
  } catch (error) {
    if (!current()) return;
    if (error.name === "AbortError") {
      setBanner("已停止");
      ensureBody(assistant, "已停止");
    } else {
      const message = error instanceof Error ? error.message : String(error);
      setBanner(message);
      ensureBody(assistant, message);
    }
  } finally {
    if (!current()) return;
    inflight = null;
    setBusy(false, "");
    removeTyping(assistant);
    input.focus();
  }
}

/* ---------- 输入框自适应 ---------- */
function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 260)}px`;
}

/* ---------- 事件绑定 ---------- */
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (busy) {
    inflight?.abort();
    return;
  }
  void sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", autosize);

transcript.addEventListener("scroll", updateScrollButton);
scrollBottom.addEventListener("click", () => {
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
});

transcript.addEventListener("click", (event) => {
  const btn = event.target.closest(".copy-btn");
  if (!btn) return;
  const code = btn.closest(".codeblock")?.querySelector("code")?.textContent || "";
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "已复制";
    setTimeout(() => (btn.textContent = "复制"), 1500);
  });
});

document.querySelector("#new-chat").addEventListener("click", resetChat);
document.querySelector("#refresh-files").addEventListener("click", () => {
  void loadTree();
});
document.querySelector("#preview-close").addEventListener("click", () => {
  preview.hidden = true;
  layout.classList.remove("show-preview");
  selectedPath = "";
  for (const item of tree.querySelectorAll(".tree-item.selected")) {
    item.classList.remove("selected");
  }
});
previewCopy.addEventListener("click", () => {
  const text = previewBody.textContent.replace(/^\d+:/gm, "");
  navigator.clipboard.writeText(text);
});

for (const chip of document.querySelectorAll("[data-prompt]")) {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.prompt;
    input.focus();
    autosize();
  });
}

void refreshStatus();
setInterval(refreshStatus, 20000);
void loadTree();
