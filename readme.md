# TeensyCode

一个极简的 coding agent harness用于ai agent练习

Agent 在本地 `workplace/` 目录里工作:能读写文件、搜索内容、执行命令、运行 Python 代码,还能通过 MCP Server 联网搜索和抓取网页。提供终端(CLI)和浏览器(Web)两种使用方式。

## 特性

- **ToolLoopAgent**:基于 `ai` SDK 的工具循环,主 Agent 最多 10 步,联网子 Agent 最多 5 步
- **本地工具**:`read` / `write` / `grep` / `bash` / `code_interpreter`
- **联网能力**:独立的 MCP Server 提供 `search` 与 `fetch`,由一个专门的子 Agent 调用,主 Agent 通过 `webTool` 委托它
- **两种前端**:终端对话,或带文件树、文件预览、流式输出(SSE)和工具调用展示的网页工作台
- **对话日志**:每次对话写入 `workplace/log-agent.txt`,联网子 Agent 写入 `workplace/log-sub.txt`

## 架构

```
┌────────────┐   ┌──────────────┐
│ CLI client │   │  Web client  │  浏览器 ⇄ frontend/ (SSE)
│  cli.ts    │   │   web.ts     │  http://127.0.0.1:8787
└─────┬──────┘   └──────┬───────┘
      └────────┬────────┘
        ┌──────▼───────┐        ┌────────────────┐
        │  client.ts   │        │   webAgent     │
        │ ToolLoop     ├─webTool►  (子 Agent)    │
        │ Agent        │        └───────┬────────┘
        └──────┬───────┘                │ MCP over HTTP
read/write/grep/bash/code_interpreter   │
        ┌──────▼───────┐        ┌───────▼────────┐
        │ LocalSandBox │        │   MCP Server   │  http://127.0.0.1:3000/WebMcp
        │  workplace/  │        │  search/fetch  │
        └──────────────┘        └───────┬────────┘
                                        ▼
                                 DeepSeek tools API
```

## 目录结构

```
src/
├── sandbox.ts          # SandBox 接口与 LocalSandBox 实现(读 / 写 / exec)
├── client/
│   ├── client.ts       # 创建 Agent、连接 MCP、组装工具
│   ├── tool.ts         # 各工具的定义(zod schema + execute)
│   ├── system.ts       # System Prompt 生成
│   ├── cli.ts          # 终端交互入口
│   └── web.ts          # HTTP + SSE 服务,托管 frontend/
├── server/
│   ├── server.ts       # MCP Server(search / fetch / 示例 prompt)
│   └── tools.ts        # 调用 DeepSeek tools API 的封装
└── test/
    ├── messageLog.ts   # 对话日志写入
    └── utils.ts         # 联网工具的手动测试脚本
frontend/               # 网页工作台(原生 HTML / CSS / JS)
workplace/              # Agent 的工作目录(已 gitignore,需手动创建)
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

建议使用较新的 Node.js(项目为 ESM 并使用顶层 `await`,推荐 20+)。如需使用 `code_interpreter`,本机还需要 `python` 在 PATH 中。

### 2. 配置环境变量

```bash
cp .env.example .env
```

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | **必填**。主 Agent 使用 `deepseek-chat`,联网搜索 / 抓取也使用同一个 Key |
| `PACKY_API_KEY` | 可选。第三方网关 packyapi,目前仅出现在 `client.ts` 被注释掉的 Anthropic 配置中,默认不会用到 |

### 3. 创建工作目录

`workplace/` 被 `.gitignore` 忽略,代码不会自动创建它,首次运行前请手动创建:

```bash
mkdir workplace
```

### 4. 启动

先启动 MCP Server(联网工具依赖它),再启动任意一个客户端:

```bash
# 终端 1:MCP Server,监听 3000 端口
npm run server

# 终端 2:二选一
npm run client-cli   # 终端对话,输入 exit 退出
npm run client-web   # 网页工作台,打开 http://127.0.0.1:8787
```

没有启动 MCP Server 时客户端仍可运行,只是联网搜索工具不可用(启动时会打印提示,网页顶部的状态标签也会显示)。

## 工具说明

| 工具 | 作用 | 备注 |
| --- | --- | --- |
| `read` | 按行读取文件,返回带行号的内容 | 支持 `offset` / `limit`,单次最多 500 行 |
| `write` | 创建或写入文件 | 默认不覆盖已存在文件;会拒绝工作目录之外的路径 |
| `grep` | 在目录下按纯文本搜索内容 | 不是正则,不区分大小写;可用 `glob` 过滤文件名;跳过 `node_modules` / `.git` 和大于 1MB 的文件;最多返回 50 条 |
| `bash` | 在 `workplace/` 中执行 shell 命令 | 返回 `stdout` 与 `exitCode` |
| `code_interpreter` | 执行 Python 代码 | 写入临时文件 `.code_temp.py` 后用 `python` 运行,结束即删除 |
| `webTool` | 委托联网子 Agent 搜索 / 抓取网页 | 底层是 MCP Server 的 `search` 与 `fetch` |

## Web 接口

`web.ts` 只监听 `127.0.0.1:8787`:

| 接口 | 说明 |
| --- | --- |
| `GET /api/status` | 返回 MCP 是否连接成功 |
| `GET /api/files?path=` | 列目录或预览文件(限制在 `workplace/` 内,最大 1MB / 500 行) |
| `POST /api/chat` | 请求体 `{ message, sessionId? }`,以 SSE 返回 `session` / `text` / `tool` / `tool-result` / `done` / `error` 事件 |

对话历史保存在服务进程内存中(按 `sessionId` 区分),重启即丢失。同一时间只允许一个对话在生成,单次请求 8 分钟超时。

## 路线图
**coding agent基础能力：**
- [x] code interpreter
- [x] grep
- [x] bash
- [x] readfile
- [x] writefile
- [ ] glob（文件名字正则搜索）
- [] edit-file

**增加内容：**
- [x] 联网搜索 / 网页抓取(MCP)
- [x] Web 前端
- [ ] cloudSandbox
- [ ] memory(考虑使用mem0框架)
- [ ] 子agent编排
- [ ] bash工具审查机制


## 安全提示

`LocalSandBox` **不是真正的隔离沙箱**,只是把命令的工作目录设为 `workplace/`:

- `write` 会拦截越界路径,但 `read`、`grep` 不会限制路径,`bash` 与 `code_interpreter` 可以执行任意命令
- Agent 拥有与当前用户相同的文件和命令权限

请只在可信环境中使用,不要把服务暴露到公网,也不要让它处理不可信的输入。
