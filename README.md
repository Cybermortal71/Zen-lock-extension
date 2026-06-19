<p align="center">
  <img src="pic/icon128.png" width="96" height="96" alt="ZenLock">
</p>

<h1 align="center">🌿 ZenLock</h1>
<p align="center"><em>温柔的时间管理浏览器扩展</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="Manifest V3">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/Platform-Microsoft%20Edge-4a90d9" alt="Platform">
</p>

---

## ✨ 核心功能

| | |
|---|---|
| 🔒 **网站锁** | 访问黑名单网站时，先输入访问目的和规划时间 |
| 🔑 **通行证机制** | 解锁后在规划时间内自由浏览，到期温柔提醒 |
| 🧠 **意图审核** | 目的太模糊？ZenLock 会追问你，帮你想清楚 |
| 📊 **时间流瀑布图** | Canvas 绘制的甘特图，直观看到每个网站的浏览分布 |
| 🌱 **盆栽成长系统** | 按时完成任务 +4 分、超时 +2、低质量 -3。每日上限 ±20 |
| 🍎 **果实收获** | 成长值达 150 随机收获果实并重置，8 种果实各有寓意 |
| 🏆 **成就徽章** | 8 项成就（初次专注、七日君子、时间大师…） |
| 🤖 **AI 周报** | 基于过去 7 天浏览数据，DeepSeek 生成 200 字时间管理总结 |
| 📋 **滴答清单集成** | 解锁页显示收集箱今日待办，保持节奏感 |

---

## 📦 安装指南

1. 从 [Releases](https://github.com) 下载 `ZenLock.zip` 并解压
2. 打开 Microsoft Edge，地址栏输入 `edge://extensions`
3. 开启「**开发人员模式**」→ 点击「**加载解压缩的扩展**」→ 选择解压后的文件夹

> 完成！点工具栏的 ZenLock 图标即可开始。

---

## 🤖 配置 AI 周报

ZenLock 使用 DeepSeek API 生成浏览周报总结。

1. 前往 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 注册并获取 API Key
2. 在扩展的**选项页** → DeepSeek API Key 输入框填入 Key → 保存
3. 打开**统计页** → 点击「📊 生成周报」

> Key 仅保存在本地浏览器，不会上传到任何第三方服务器。

---

## 📋 配置滴答清单

1. 前往 [developer.dida365.com](https://developer.dida365.com) 注册应用并获取 Access Token
2. 在扩展的**选项页** → 滴答清单 Token 输入框填入 Token → 保存
3. 访问黑名单网站触发解锁页，右侧将显示收集箱今日待办任务

---

## 🛠 技术栈

| 技术 | 用途 |
|---|---|
| Manifest V3 | 扩展框架 |
| Chrome Extension API | tabs、storage、alarms、idle、notifications |
| Canvas 2D API | 时间流瀑布图（零外部依赖） |
| DeepSeek API | AI 周报总结 |
| 滴答清单 Open API | 今日待办同步 |

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE)。代码可以自由使用、修改和分发。

> 虽然代码是 MIT 协议，但 **Zenlock** 这个名字和它的品牌形象（包括植物盆栽系统、禅意设计）保留给原作者。如果你基于此项目做修改并发布，请换个名字，不要冒充官方版本。

---

<p align="center">
  <sub>「把时间花在值得的地方。」</sub>
</p>
