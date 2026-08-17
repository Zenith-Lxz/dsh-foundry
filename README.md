# DSH Foundry · DSH 铸造台

[English](README.en.md) · [Releases](https://github.com/Zenith-Lxz/dsh-foundry/releases)

**官方 DeepSeek Harness，零补丁桌面版。**

不装 Node。不开终端。不 fork 上游。  
打开应用，Harness 就在里面 —— 运行时、发行版、包管理器全封进包里。

> 本项目**不是** DeepSeek 官方产品。官方 DSH 归 DeepSeek；我们只是把它当固定版本的外部依赖，外面套了一层真正的桌面壳。

---

## 下载

| 平台 | 安装包 | 状态 |
| --- | --- | --- |
| **macOS Apple Silicon** | [`.dmg`](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest) | 已验收 |
| **Windows x64** | [`.exe` Setup](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest) | 构建候选\* |

\* Windows 包能编出来，**从未在真实 Windows 主机上跑过**，不作为已验收平台。

安装包**未签名、未公证**。macOS 第一次请右键 → 打开；Windows 会撞 SmartScreen，选「更多信息 → 仍要运行」。

---

## 它多给了什么

官方 DSH 是「一切皆插件」的 agent 框架。Foundry 在**不改它一行源码**的前提下，加上四样东西：

| | |
| --- | --- |
| **真·桌面应用** | macOS `.app` / Windows 安装器，主题跟系统走 |
| **仓库工作台** | `@file` 引用、有界搜索、**只读** Git 评审、验证证据 |
| **插件来源治理** | 谁发的、有没有审过、关掉会怎样 —— 官方列表答不了 |
| **评测框架** | 45 任务语料 + 双向 oracle；报告会自己写「未运行」 |

**核心原则：不 fork、不 vendor、不打补丁、不深导入、不 monkey patch。**  
上游发版，我们直接吃；合并债为零。

```bash
pnpm run gate:coupling   # 强制执行，不是口号
```

---

## 30 秒上手（从源码）

```bash
pnpm install
pnpm run bundle
pnpm run build:icon
pnpm run package:darwin-arm64
open "release/darwin-arm64/DSH Foundry-darwin-arm64/DSH Foundry.app"
```

只要插件、不要桌面壳：

```bash
dsh plugin --profile <name> add @dsh-foundry/daily-bundle
```

---

## 设计取舍（很短）

- **业务流量走官方通路**（HTTP / WebSocket / Typert）。Electron IPC 只做窗口、选目录、外链、生命周期。
- **Bridge 是封闭对象**：没有 `invoke(channel)`，没有裸 `ipcRenderer`，preload 面冻结。
- **路径是原生不透明字符串**：Windows 盘符 / UNC 绝不被「规范化」成 POSIX。
- **误配置尽早炸**，绝不静默退化成坏掉的按钮。

---

## 证据（可复现）

| 检查 | 结果 |
| --- | --- |
| `pnpm run mechanics` | **15 / 15** |
| `pnpm run smoke:app` | **19 / 19** |
| `pnpm run verify:window` | **16 / 16** |
| `npx vitest run` | **1134 通过 / 51 文件** |
| 上游 checkout | **0** 处 tracked 改动 |

```bash
pnpm run mechanics
pnpm run smoke:app
pnpm run verify:window
pnpm run acceptance:darwin
```

---

## 实测结果

**不声称任何性能优势。**

数字全部来自 [`evidence/pilot-report.md`](evidence/pilot-report.md)（原始样本 `evidence/pilot-runs.json`）。仓库里没有留存数据的运行，一个数字都不会出现 —— `tests/readme-claims.test.ts` 会让假数字直接挂构建。

语料设计是 45 任务 / 9 类。在册对照只有一次**试跑**：5 任务 × 1 次 × 仅 macOS arm64。

| 配置 | 平台 | 有效运行 | 验证通过 | 中位耗时 | 中位 token |
| --- | --- | --- | --- | --- | --- |
| 官方 Standard | darwin | 5 | 80.0% | 18.2s | 9 801 |
| daily-lean | darwin | 5 | 80.0% | 19.4s | 9 117 |

**UNDECIDED。** promotion 要满语料、每任务 3 次、双平台；这次什么都不够。5 次单跑里 1.4 秒 / 684 token 的差是噪声。  
**从未与 Claude Code、Codex 或任何其他 DSH 发行版比较过。**

---

## 从源码开发

```bash
pnpm install
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run bundle
pnpm run package:darwin-arm64   # 或 package:win32-x64
pnpm run installer darwin-arm64 # → release/installer/*.dmg
pnpm run installer win32-x64    # → release/installer/*.exe
```

| 需要 | 版本 |
| --- | --- |
| Node | ≥ 24.18.0（`mise.toml` 已钉） |
| pnpm | 11.7.0 |
| 官方 DSH | `0.1.0-rc.6`（范围 `>=0.1.0-rc.6 <0.2.0`） |

```
apps/desktop/       Electron 主进程 · preload · 窗口策略 · 进程监管
packages/           适配器 · bridge 契约 · 布局/原生插件 · 工作台 · 评测
scripts/            staging · 闸门 · 打包 · 安装器
corpus/             评测语料
assets/             图标源文件
```

---

## 已知边界

- Windows：**构建候选**，未真机验收
- 默认编程配置：**未通过 promotion**
- 安装包：**未签名 / 未公证**
- `will-navigate` 跨源拦截：未经验证（bridge 按 origin 授权，空白页 `null` origin 会被拒）

---

## 许可

MIT · 与 DeepSeek 无隶属关系
