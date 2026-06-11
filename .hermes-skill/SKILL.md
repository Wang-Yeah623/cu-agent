---
name: cu-agent
description: "Cu Agent — WeChat驱动的半自主编程Agent。接收需求、拆解任务、操控Codex桌面版、检测进度、持续迭代。"
version: 1.0.0
author: Cu Agent Team
license: MIT
platforms: [windows, linux, macos]
metadata:
  hermes:
    tags: [Coding-Agent, Cu-Agent, Project-Management, Progress-Tracking, WeChat]
    related_skills: [codex, claude-code, subagent-driven-development]
---

# Cu Agent

Cu Agent 是一个 WeChat 驱动的半自主编程 Agent。
通过微信接收需求，自动拆解任务，操控 Codex 桌面版执行编码，持续检测完成度并汇报进度。

## 工作流程

```
用户微信发需求 → Cu Agent 分析 → 拆解子任务 
→ 逐任务执行（操控 Codex 桌面版） 
→ 每步检测进度 
→ 微信汇报 
→ 用户可随时微信纠正方向
```

## 什么时候用

- 需要从零开始搭建一个完整的项目
- 需要一个不盯着屏幕也能推进的编程助手
- 想在微信上管理多个编程项目

## 启动方式

Cu Agent 运行在用户电脑上，作为独立进程运行。
Hermes 通过终端命令或 ACP 协议与 Cu Agent 通信。

### 启动 Cu Agent（带 Mock Hermes API）:

```bash
cd F:\computer use\CuAgent

# 启动 Mock Hermes API（如未安装真实模型）
npx tsx tests/mock-hermes.ts

# 启动 Cu Agent Host
set HERMES_API_ENDPOINT=http://127.0.0.1:11434
npx tsx src/main.ts
```

### 启动 Cu Agent（带真实模型）:

```bash
set HERMES_API_ENDPOINT=http://localhost:11434
set HERMES_MODEL=hermes-3-llama-3.1-8b
npx tsx src/main.ts
```

## Cu Agent 能力

Cu Agent 提供以下子能力:

### 1. 项目创建与管理

```bash
# 通过 Hermes 终端向 Cu Agent 发送需求
hermes send "帮我做一个个人博客网站"
```

Cu Agent 接收后会:
1. 解析需求和技术栈
2. 拆解为 4-15 个子任务
3. 按依赖顺序排列
4. 开始逐任务执行

### 2. 执行循环

```
执行的每一步:
┌──────────┐
│ 执行任务  │  →  操控 Codex 桌面版
└────┬─────┘
     ▼
┌──────────┐
│ 检测进度  │  →  检查文件产出、代码质量、可运行性
└────┬─────┘
     ├── ✅ 正常 → 进入下一个任务
     ├── ⚠️ 偏离 → 自行修正或问用户
     └── ❓ 不确定 → 微信问用户
```

### 3. 进度报告

Cu Agent 自动生成结构化进度报告:
- 完成百分比
- 已完成/总任务数
- 下一步计划
- 偏离标记

### 4. 微信通信

用户通过企业微信 Clawbot 与 Cu Agent 通信:

| 用户消息 | Cu Agent 响应 |
|---------|-------------|
| "帮我做一个博客" | 创建项目，开始规划 |
| "进度？" | 返回当前进度报告 |
| "数据库换成 PostgreSQL" | 修改计划，重新规划 |
| "可以" / "继续" | 继续执行 |
| "停" | 暂停当前项目 |

## 项目结构

```
F:\computer use\CuAgent\
├── src/
│   ├── core/          核心类型/协议/常量
│   ├── registry/      插件注册表/安全门控
│   ├── hermes/        Hermes 模型客户端/意图解析/任务规划/进度检测
│   ├── executor/      Codex适配器/终端/文件系统
│   ├── loop/          执行循环/状态机
│   ├── wechat/        WeChat Clawbot桥接
│   ├── plugin-codex/  Codex桌面版插件
│   ├── host/          应用组装
│   └── main.ts        服务入口
├── tests/             测试（41项全部通过）
└── package.json
```

## 依赖

- Node.js >= 18
- 如需真实 LLM 能力: Ollama + Hermes 模型 或 OpenAI API
- 如需 Codex 桌面版操控: Codex 桌面版 + Cu Plugin
- 如需微信通信: 企业微信机器人 Webhook URL

## 安全注意事项

- Cu Agent 不会执行 `rm -rf /` 等危险命令
- 文件操作限制在项目目录沙箱内
- 删除操作需要用户微信确认
- Codex 桌面版只能通过本地 WebSocket 通信
