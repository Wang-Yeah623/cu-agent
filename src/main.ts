/**
 * Cu Agent — 服务入口
 *
 * 启动 Cu Agent Host 服务，监听 HTTP 端口和 WeChat 消息。
 */

import { CuAgentApp } from "./host/app";

async function main() {
  const app = new CuAgentApp({
    hermes: {
      apiEndpoint: process.env.HERMES_API_ENDPOINT ?? "http://localhost:11434",
      apiKey: process.env.HERMES_API_KEY,
      modelName: process.env.HERMES_MODEL ?? "hermes-3-llama-3.1-8b",
      temperature: 0.3,
    },
    wechat: {
      webhookUrl: process.env.WECHAT_WEBHOOK_URL ?? "",
      botName: "Cu Agent",
      secret: process.env.WECHAT_SECRET,
    },
    workspace: {
      projectsDir: process.env.CU_PROJECTS_DIR ?? "./projects",
    },
    codex: {
      host: process.env.CODEX_PLUGIN_HOST ?? "localhost",
      port: parseInt(process.env.CODEX_PLUGIN_PORT ?? "9876", 10),
      bindingKey: process.env.CODEX_BINDING_KEY ?? "",
    },
  });

  try {
    // 验证配置
    if (!app.validateConfig()) {
      console.error("❌ Configuration validation failed.");
      console.error("Required env vars:");
      console.error("  WECHAT_WEBHOOK_URL  - 企业微信机器人 Webhook URL");
      console.error("  CODEX_BINDING_KEY   - Codex 桌面版插件绑定密钥");
      console.error("Optional env vars:");
      console.error("  HERMES_API_ENDPOINT - 默认为 http://localhost:11434");
      console.error("  HERMES_API_KEY      - 如需要认证");
      console.error("  CU_PROJECTS_DIR     - 默认为 ./projects");
      console.error("  CODEX_PLUGIN_PORT   - 默认为 9876");
      process.exit(1);
    }

    console.log(`
╔══════════════════════════════════╗
║        Cu Agent v0.1.0          ║
║    启动中...                      ║
╚══════════════════════════════════╝
`);

    // 启动应用
    await app.start();
    console.log(`✅ Cu Agent 已就绪`);
    console.log(`📡 WeChat Clawbot: ${process.env.WECHAT_WEBHOOK_URL ? "已配置" : "未配置"}`);
    console.log(`🖥️  Codex Plugin:  ${process.env.CODEX_BINDING_KEY ? "等待绑定" : "未配置"}`);
    console.log(`🧠 Hermes 端点:   ${process.env.HERMES_API_ENDPOINT ?? "http://localhost:11434"}`);

    // 优雅关闭
    const shutdown = async () => {
      console.log("\n⏳ 正在关闭...");
      await app.stop();
      console.log("👋 Cu Agent 已关闭");
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error("❌ 启动失败:", error);
    process.exit(1);
  }
}

main();
