# Cu Agent — 30 秒 Demo 分镜脚本

> 目标:30 秒内让人产生「**卧槽,给微信发条消息就能写代码?**」的冲动。
> 用途:README 顶部的 hero GIF / 发 Twitter·掘金·公众号·小红书的短视频。

## 规格

- **时长**:25–30 秒(README GIF 建议 ≤ 15s、≤ 8MB;长版发视频平台)
- **画幅**:横版 16:9(GitHub/Twitter)+ 竖版 9:16(抖音/小红书/视频号)各导一版
- **节奏**:快。每个镜头 2–5 秒,多用加速/跳剪。配一段轻快电子乐。
- **字幕**:全程烧大字幕(很多人静音看)。中英各一版。

## 两种录法

| 方式 | 真实感 | 难度 | 说明 |
|---|---|---|---|
| **A. 真微信 + 电脑** | ⭐⭐⭐ | 中 | 手机拍微信 + 录屏拍电脑,分屏剪辑。最有说服力 |
| **B. 网页 Demo(推荐起步)** | ⭐⭐ | 低 | 直接录 `npm run demo` 的网页,一块屏幕搞定,零配置 |

> 先用 **B** 快速出一版(`npm run demo` 那个网页本身就是为录制设计的),验证反响后再补 **A** 的真机版。

## 分镜表(方式 A:手机 + 电脑)

| 时间 | 画面 | 烧屏字幕 | 备注 |
|---|---|---|---|
| 0:00–0:03 | 黑底,一行字淡入 | **「让 AI 写代码,还要盯着 IDE?」** | 钩子:制造痛点 |
| 0:03–0:04 | 字翻转 | **「这次,发条微信就行。」** | 反转 |
| 0:04–0:09 | 手机特写:微信输入框打字 → 发送 | 输入气泡:**"帮我做一个个人博客网站"** | 真机拍最佳 |
| 0:09–0:13 | 切电脑屏:终端亮起 | **"收到需求 → 拆成 6 个任务"** | 显示任务列表滚动 |
| 0:13–0:20 | 加速:VS Code 里文件一个个冒出来、代码自动写入 | **"它在你电脑上真的动手写"** | 这是高潮,多给两秒 |
| 0:20–0:24 | 手机震动,微信弹出进度卡片 | **"进度实时发回微信 📊 60%"** | 体现 async |
| 0:24–0:26 | (可选)微信弹出一个提问,用户回一句 | **"不确定时它会问你,而不是乱写"** | 差异化:human-in-the-loop |
| 0:26–0:29 | 电脑:浏览器打开刚生成的博客页面 | **"几分钟,一个能跑的项目"** | 成果兑现 |
| 0:29–0:30 | 收尾卡:Logo + 一句话 + 仓库地址 | **Cu Agent ⭐ github.com/Wang-Yeah623/cu-agent** | 行动号召 |

## 分镜表(方式 B:网页 Demo,最省事)

| 时间 | 画面 | 烧屏字幕 |
|---|---|---|
| 0:00–0:03 | 网页 demo 首屏(深色、干净) | **「给 AI 发条需求,看它写代码」** |
| 0:03–0:06 | 在输入框打"帮我做一个个人博客网站",点「运行」 | — |
| 0:06–0:10 | 左侧聊天区:agent 回「收到 → 拆 6 个任务」 | **"自动拆解任务"** |
| 0:10–0:22 | 右侧文件区:`index.html`、`style.css`… 一个个出现,代码滚动写入 | **"在线生成、实时可见"** |
| 0:22–0:26 | 左侧进度条 10% → 30% → …,agent 报进度 | **"每步自检 + 汇报"** |
| 0:26–0:30 | 收尾卡:Logo + 仓库地址 | **Cu Agent ⭐ Star on GitHub** |

## 收尾卡内容

```
            Cu Agent  🤖
  Text your AI on WeChat. Wake up to working code.
        ⭐  github.com/Wang-Yeah623/cu-agent
```

## 录制 & 导出小贴士

- **录屏**:Windows 用 [ScreenToGif](https://www.screentogif.com/)(直接出 GIF)或 OBS(出 mp4 再转 GIF)。
- **手机**:自带录屏,或相机俯拍真机(更有「真实」感)。
- **加速**:写代码那段用 4–8× 速;别让观众等。
- **GIF 体积**:README 那版控制在 ≤ 8MB、≤ 15s,宽度 ~1000px,12–15fps;太大 GitHub 加载慢。
- **音乐**:无版权电子/lo-fi(YouTube Audio Library、Pixabay)。
- 导出后把横版 GIF 放进仓库 `assets/demo.gif`,README 顶部把 banner 换成它(或并列)。

## 配文(发帖用,可直接抄)

**中文(掘金/公众号/即刻):**
> 我做了个开源项目 Cu Agent:**给微信发条需求,它就在你电脑上把代码写出来**,还会实时把进度发回微信、拿不准时停下来问你。半自主、人在环里,支持 DeepSeek 等任意大模型。求 Star 🌟 github.com/Wang-Yeah623/cu-agent

**English(Show HN / Twitter/X):**
> Show HN: Cu Agent — text a requirement to WeChat, and it writes the code on your computer (driving VS Code), reporting progress back and asking when unsure. Semi-autonomous, human-in-the-loop, any OpenAI-compatible LLM. ⭐ github.com/Wang-Yeah623/cu-agent
