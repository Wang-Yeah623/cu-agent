# Cu Plugin for Codex (VS Code 扩展)

Cu Agent 的**编辑器侧插件**。它在编辑器内开一个本地 WebSocket 服务（默认端口 `9876`），
接收 Cu Agent Host 发来的操控指令（文件读写、终端执行、打开文件、读取诊断等），并在编辑器里执行。

> 这是 `../src/plugin-codex` 那份「骨架」的可运行版本。协议从主项目
> `../src/core/protocol.ts` 精简复制到 [`src/protocol.ts`](src/protocol.ts)（不含 zod）——
> 主项目协议若变更，请同步这份。

## 在 VS Code 里测试（开发模式）

```bash
cd cu-plugin-codex
npm install
npm run compile        # 或在 VS Code 里直接 F5（会自动编译）
```

1. 用 VS Code 打开 **本文件夹**（`cu-plugin-codex`）。
2. 按 **F5** → 弹出一个「扩展开发宿主」窗口，插件在其中激活。
3. 右下角会提示绑定密钥与端口；命令面板里有 `Cu Agent: 显示插件状态`。
4. 此时插件已在 `ws://127.0.0.1:9876` 监听，Cu Agent Host 连上后即可操控这个窗口。

## 与 Host 联调

启动 Host（`CODEX_PLUGIN_PORT=9876` 与本插件端口一致），Host 的 `CodexAdapter`
会连到本插件；连上后文件/终端操作会走编辑器，而不是本地直接读写。

## 命令

- `Cu Agent: 显示绑定密钥`
- `Cu Agent: 显示插件状态`

## 设置

- `cuAgent.port`：WebSocket 端口（默认 9876，需与 Host 的 `CODEX_PLUGIN_PORT` 一致）。
