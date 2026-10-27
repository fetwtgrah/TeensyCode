import { WebMcpTools, Localtools, agent, mcpClient, cwd } from "./client.js"
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { MessagePrint } from "../utils/messageLog.js";


console.log("🧰WebMcp server可用工具:", Object.keys(WebMcpTools).join(', ') || '无')
console.log("🧰local 可用工具：", Object.keys(Localtools).join(",") || "无")
console.log("================exit退出====================")
console.log("============================================")

const messages: any[] = []

//一个终端交互页面
const r = readline.createInterface({ input, output })
try {
  while (1) {
    const userInput = await r.question("\nYOU>:")
    if (userInput == 'exit') break
    if (!userInput.trim()) continue
    messages.push({ role: "user", content: userInput })
    const result = await agent.generate({
      messages: messages
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
  MessagePrint(messages, cwd, "agent")
}
