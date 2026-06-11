/**
 * Cu Agent — Hermes Mock API Server
 *
 * 模拟 Hermes 模型的 API 行为，用于端到端测试。
 * 启动后监听 11434 端口（与 Ollama 默认端口一致）。
 */

import http from "http";

const PORT = 11434;

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function: { name: string } }>;
}

function handleChat(body: ChatRequest) {
  const lastMsg = body.messages?.at(-1)?.content ?? "";
  const tools = body.tools ?? [];

  // 意图解析
  if (tools.some((t) => t.function.name === "parse_intent")) {
    if (lastMsg.includes("帮我做") || lastMsg.includes("博客") || lastMsg.includes("待办")) {
      return {
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "parse_intent",
                arguments: JSON.stringify({ action: "CREATE_PROJECT", confidence: 0.95, target: "", value: lastMsg }),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      };
    }
    if (lastMsg.includes("进度") || lastMsg.includes("到哪了")) {
      return {
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_2",
              type: "function",
              function: {
                name: "parse_intent",
                arguments: JSON.stringify({ action: "REPORT_PROGRESS", confidence: 0.9 }),
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      };
    }
    // 默认回退
    return {
      choices: [{
        message: { content: JSON.stringify({ action: "CREATE_PROJECT", confidence: 0.5, value: lastMsg }) },
        finish_reason: "stop",
      }],
    };
  }

  // 任务规划
  if (lastMsg.includes("拆解") || lastMsg.includes("子任务") || lastMsg.includes("规划")) {
    const plan = {
      tasks: [
        { name: "项目初始化", description: "创建项目目录和依赖配置", order: 0, progressWeight: 15, dependsOn: [] },
        { name: "核心功能开发", description: "实现主要业务逻辑", order: 1, progressWeight: 50, dependsOn: ["项目初始化"] },
        { name: "UI 开发", description: "开发用户界面", order: 2, progressWeight: 20, dependsOn: ["核心功能开发"] },
        { name: "集成与测试", description: "集成各组件并进行测试", order: 3, progressWeight: 15, dependsOn: ["核心功能开发", "UI 开发"] },
      ],
      techStack: { framework: "Next.js", language: "TypeScript" },
      summary: lastMsg.slice(0, 100),
    };
    return { choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 150, total_tokens: 250 } };
  }

  // 代码生成
  if (lastMsg.includes("file.create") || lastMsg.includes("任务名称") || lastMsg.includes("生成")) {
    const actions = [
      { type: "file.create", payload: { path: "/project/package.json", content: '{"name":"demo","scripts":{"dev":"next dev"}}' } },
      { type: "file.create", payload: { path: "/project/src/index.ts", content: 'console.log("Hello from Cu Agent!");' } },
      { type: "terminal.exec", payload: { command: "npm init -y", cwd: "/project" } },
    ];
    const content = "```json\n" + JSON.stringify(actions) + "\n```";
    return { choices: [{ message: { content, finish_reason: "stop" } }], usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 } };
  }

  // 进度检测
  if (lastMsg.includes("进度检测") || lastMsg.includes("percentage")) {
    const progress = { percentage: 45, deviationLevel: "none", summary: "项目框架搭建完成，核心功能开发中", nextTask: "实现业务逻辑", needsUserInput: false, userQuestion: "" };
    return { choices: [{ message: { content: JSON.stringify(progress) } }], finish_reason: "stop" };
  }

  // 通用回退
  return {
    choices: [{ message: { content: "I'm a mock Hermes API for Cu Agent testing." }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const result = handleChat(parsed);
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
  } else if (req.method === "GET" && req.url === "/health") {
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`🧪 Hermes Mock API Server running on http://127.0.0.1:${PORT}`);
  console.log(`   POST /v1/chat/completions  (Hermes-compatible API)`);
  console.log(`   GET  /health`);
});
