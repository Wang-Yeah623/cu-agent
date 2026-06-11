# Cu Agent 🤖

**WeChat 驱动的半自主编程 Agent**

给微信发一条需求，Cu Agent 就在 Codex 桌面版里帮你写代码。  
每完成一个子任务自动检测进度，遇到问题在微信上问你，你随时可以纠正方向。

---

## 项目结构

```
CuAgent/
├── src/
│   ├── core/              # 核心类型 + 协议 + 常量
│   │   ├── types.ts        数据模型（Project, SubTask, Action...）
│   │   ├── protocol.ts     Plugin WebSocket 通信协议
│   │   └── constants.ts    全局常量
│   │
│   ├── registry/          # 插件注册表 + 安全门控
│   │   ├── registry.ts     插件绑定/解绑/连接管理
│   │   └── security.ts     命令检查/路径沙箱/审批队列
│   │
│   ├── hermes/            # Hermes 模型层
│   │   ├── client.ts        Hermes API 客户端
│   │   ├── intent-parser.ts 用户意图解析
│   │   ├── task-planner.ts  任务规划（需求 → 子任务）
│   │   └── progress-detector.ts 进度检测（核心差异化）
│   │
│   ├── executor/          # 执行层
│   │   ├── codex-adapter.ts  Codex 桌面版适配器（WebSocket）
│   │   ├── terminal.ts      终端适配器（子进程）
│   │   └── filesystem.ts    文件系统适配器
│   │
│   ├── loop/              # 执行循环
│   │   ├── execution-loop.ts 核心闭环（执行→检测→规划→执行）
│   │   └── state-machine.ts  状态机（9 状态）
│   │
│   ├── wechat/            # WeChat Clawbot 通信
│   │   ├── bridge.ts        Clawbot 桥接器（发送/接收）
│   │   └── message-handler.ts 消息路由（意图→动作）
│   │
│   ├── plugin-codex/      # Codex 桌面版插件
│   │   └── extension.ts    WebSocket 服务器 + VS Code API 适配
│   │
│   ├── host/              # 主应用
│   │   └── app.ts           CuAgentApp 组装启动类
│   │
│   └── main.ts            # 服务入口
```

## 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 设置环境变量
set WECHAT_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
set CODEX_BINDING_KEY=your-binding-key
set HERMES_API_ENDPOINT=http://localhost:11434

# 3. 编译
npm run build

# 4. 启动
node dist/main.js
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `WECHAT_WEBHOOK_URL` | ✅ | - | 企业微信机器人 Webhook |
| `CODEX_BINDING_KEY` | ✅ | - | Codex 桌面版插件绑定密钥 |
| `HERMES_API_ENDPOINT` | ❌ | `http://localhost:11434` | Hermes API 端点 |
| `HERMES_API_KEY` | ❌ | - | Hermes API 认证密钥 |
| `HERMES_MODEL` | ❌ | `hermes-3-llama-3.1-8b` | 模型名称 |
| `CU_PROJECTS_DIR` | ❌ | `./projects` | 项目代码输出目录 |
| `CODEX_PLUGIN_PORT` | ❌ | `9876` | Codex 插件 WebSocket 端口 |

## 构建说明

```bash
# 编译
npm run build

# 持续编译（开发）
npm run watch

# 测试
npm test

# 代码检查
npm run lint
```
