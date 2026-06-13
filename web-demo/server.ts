/**
 * Cu Agent — 网页 Demo 模式
 *
 * 免企业微信、免 VS Code 插件:一个本地网页,输入需求 → 看 agent 用真实大模型
 * 拆任务、生成代码(本地写文件)、实时回报进度。SSE 把事件推到浏览器。
 *
 * 运行:  npm run demo   (需要先设好 HERMES_API_KEY 等环境变量)
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";

import { HermesClient } from "../src/hermes/client";
import { TaskPlanner } from "../src/hermes/task-planner";
import { ProgressDetector } from "../src/hermes/progress-detector";
import { ExecutionLoop } from "../src/loop/execution-loop";
import { CodexAdapter } from "../src/executor/codex-adapter";
import { TerminalAdapter } from "../src/executor/terminal";
import { FileSystemAdapter } from "../src/executor/filesystem";
import { SecurityGate } from "../src/registry/security";

const PORT = Number(process.env.DEMO_PORT || 8787);
const MAX_TASKS = Number(process.env.DEMO_MAX_TASKS || 3);
const OUT = path.join(process.cwd(), ".web-demo-out");
const HTML_PATH = path.join(process.cwd(), "web-demo", "public", "index.html");

const endpoint = process.env.HERMES_API_ENDPOINT || "https://api.deepseek.com";
const apiKey = process.env.HERMES_API_KEY;
const model = process.env.HERMES_MODEL || "deepseek-chat";

const clients: http.ServerResponse[] = [];
const send = (event: string, data: unknown) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of [...clients]) { try { c.write(payload); } catch { /* ignore */ } }
};

let running = false;

function pushFiles(): void {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string, rel: string) => {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const fp = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(fp);
      if (st.isDirectory()) walk(fp, r);
      else if (st.size <= 60000) { try { files.push({ path: r, content: fs.readFileSync(fp, "utf-8") }); } catch { /* ignore */ } }
    }
  };
  walk(OUT, "");
  send("files", { files });
}

async function run(requirement: string): Promise<void> {
  if (running) { send("agent", { text: "已有一个任务在跑，请稍候…" }); return; }
  if (!apiKey) {
    send("agent", { text: '⚠️ 没检测到 HERMES_API_KEY。先 `setx HERMES_API_KEY "sk-..."`，重开终端再 `npm run demo`。' });
    send("done", {}); return;
  }
  running = true;
  send("reset", {});
  try {
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* ignore */ }
    fs.mkdirSync(OUT, { recursive: true });

    const hermes = new HermesClient({ apiEndpoint: endpoint, apiKey, modelName: model });
    const gate = new SecurityGate(); gate.addAllowedPath(OUT);
    const loop = new ExecutionLoop(
      hermes, new TaskPlanner(hermes), new ProgressDetector(hermes),
      new CodexAdapter("127.0.0.1", 9876), new TerminalAdapter(OUT), new FileSystemAdapter(), gate
    );

    let done = 0;
    loop.on("log", (e: any) => send("log", e));
    loop.on("task:start", (t: any) => send("agent", { text: `🔨 ${t.name}` }));
    loop.on("task:complete", (t: any, s: any) => {
      send("agent", { text: `✅ ${t.name} · 进度 ${s?.percentage ?? "?"}%` });
      pushFiles();
      if (++done >= MAX_TASKS) { send("agent", { text: `（demo 限制：已完成 ${MAX_TASKS} 个任务，停止）` }); loop.stop(); }
    });
    loop.on("progress:update", (s: any) => send("progress", { pct: s?.percentage ?? 0 }));
    loop.on("user:question", (q: string) => send("agent", { text: `🤔 ${q}` }));
    loop.on("loop:complete", () => { send("agent", { text: "🎉 全部完成！" }); pushFiles(); });
    loop.on("loop:error", (err: any) => send("agent", { text: "❌ " + (err?.message || String(err)) }));

    send("agent", { text: `收到需求：「${requirement}」，正在拆解任务…` });
    await loop.createProject(requirement, OUT);
    await loop.start();
    pushFiles();
  } catch (e: any) {
    send("agent", { text: "❌ 出错：" + (e?.message || String(e)) });
  } finally {
    running = false;
    send("done", {});
  }
}

http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/" || url === "/index.html") {
    try { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(fs.readFileSync(HTML_PATH, "utf-8")); }
    catch { res.writeHead(500); res.end("index.html not found"); }
    return;
  }
  if (url === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ model, endpoint, hasKey: !!apiKey, maxTasks: MAX_TASKS }));
    return;
  }
  if (url === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(":ok\n\n");
    clients.push(res);
    req.on("close", () => { const i = clients.indexOf(res); if (i >= 0) clients.splice(i, 1); });
    return;
  }
  if (url === "/api/run" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      let requirement = "帮我做一个纯静态的 HTML 个人主页";
      try { const j = JSON.parse(b); if (j.requirement) requirement = String(j.requirement).slice(0, 500); } catch { /* ignore */ }
      res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}');
      void run(requirement);
    });
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(PORT, () => {
  console.log(`\n🌐 Cu Agent 网页 Demo:  http://localhost:${PORT}`);
  console.log(`   模型: ${model} @ ${endpoint}  ${apiKey ? "(key ✓)" : "(⚠️ 未设置 HERMES_API_KEY)"}`);
  console.log(`   生成目录: ${OUT}\n`);
});
