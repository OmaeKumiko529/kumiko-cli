# 常态命令行（Terminal Mode）设计方案

本文档对应 `request.md` 末尾新增的「常态命令行，接受默认 linux 命令」一节，记录该功能的设计、
实现拆分、边界处理和开放问题。

## 1. 背景与目标

KUMIKO CLI 平时是一个「工作区 + 分支」语义的命令行：`sync` 把本地 commit 推到服务器，
`build` / `run` 在服务器上的 worktree 里执行。但对开发者（以及被 IDE 注册的 Agent）来说，
经常需要直接看一眼服务器上的目录、跑一条 `git status`、检查一个日志文件。

目标是在不离开 REPL 的前提下，把「默认 linux 命令」变成一等公民：

- REPL 里无法匹配 kumiko 命令的输入，直接当作原生命令执行；
- 原生命令在**远端服务器**上执行（不是本地），与 kumiko 的 server 上下文一致；
- 用一个「虚拟根目录」统一路径显示：`/projects/<name>`、`/logs`、`/repos`、`/run`；
- 提示符同时反映「当前命令类型」和「当前执行位置」。

选择远端执行的关键理由：request 演示里在工作区中执行 `git push` 输出
`Everything up-to-date.`。kumiko 本地仓库在 sync 时只用 URL 推送、从不配置 origin，
本地 `git push` 会失败；而远端 worktree 是从 bare repo clone 的、有 origin，所以只有
「在服务器上执行」才能得到该输出。这也与 `bash -lc`（走 PATH 配置的 CLI）的注释一致。

## 2. 需求行为对照

| request 演示 | 实现 |
| --- | --- |
| 工作区中 `cd src` → `ERROR cd command cannot be used when a workspace and branch have been specified.` | `changeDirectory()` 在 `mode === 'kumiko'` 且已选项目时直接报同一句错误；错误前缀保持 `KUMIKOCLI` |
| 工作区中 `ls` → 前缀变 `LINUX`，输出 `[*] testProject` 树 | 裸 `ls`（无参数）在远端执行 `ls -1Ap`，由 kumiko 渲染成 `[*]` / `[/]` 树；带参数时原样透传 |
| `kumiko switch /` → 回到空工作区，提示符 `KUMIKOCLI personalServer $>` | 清空 project，shell 回根目录 `''`（提示符隐藏根路径） |
| 空工作区 `ls` → `[/]` 树 | 同上，根目录头部为 `[/]` |
| `cd mc-server` → 提示符 `... /mc-server $>` | 允许（无项目约束），远端校验目录存在后写 `state.shell.cwd` |
| `git -v` → 前缀 `GIT`，输出 `git version ...` | 已知工具名映射大写前缀（GIT/NPM/NODE/...），其余为 `LINUX`；远端 `bash -lc` 执行并流式回显 |
| `switch testProject:/main` → `KUMIKOCLI personalServer testProject:/main $>` | 原有 switch 逻辑 + `state.shell = { mode: 'kumiko', cwd: 'projects/testProject' }` |
| `switch current -terminal` → `KUMIKOCLI personalServer /projects/testProject $>` | shell 模式切到 terminal，cwd 设为工作区根；提示符显示 `/[cwd]` |
| 仓库内 `git ...` 后出现 `NOTICE A kumiko config include in repo...` | `git` 命令且 cwd 在 `projects/<name>` 下、远端存在 `.kumiko.toml`、项目设置 `commond` 开启时，在输出后打印 NOTICE（每个 git 命令都提示） |
| `switch current -kumiko` → 回到 `project:/branch` 提示符 | shell 模式切回 kumiko，cwd 仍为工作区根，`cd` 重新禁用 |
| `kumiko setting commond` 关闭通知 | 新增项目设置 `commond`（写在 `.kumiko.toml` 的 `[settings] commond = false`），`setting commond on\|off` 可改 |
| `kumiko commond` 获得更顺手的 Git 体验 | 新增命令：`commond status/log/diff/add/commit/push/pull`，内部走原生 shell 执行对应 git 命令（GIT 前缀、远端执行、保留 NOTICE 逻辑） |

## 3. 架构与状态机

### 3.1 远端布局与虚拟根

远端 kumiko 目录布局（现有实现）：

```
$HOME/kumiko/
├── repos/<name>.git     # bare repo，sync 的推送目标
├── projects/<name>/     # worktree，build/run/terminal 的执行目录
├── logs/<name>.run.log  # run 的日志
└── run/                 # run 的 pid / launcher
```

`src/shell.ts` 里 `REMOTE_ROOT = '$HOME/kumiko'` 作为虚拟根（`/`）。虚拟 cwd 是相对该根的
POSIX 路径字符串：

- `''` → `/`（根，提示符不显示）
- `'projects/testProject'` → `/projects/testProject`
- `'logs'` → `/logs`

所有原生命令的实际执行形式：

```bash
cd "$HOME/kumiko"/<quoted virtual cwd> && bash -lc <quoted raw command>
```

`cd` 的目录校验同理：`cd "$HOME/kumiko"/<path> && echo yes`。

### 3.2 shell 状态

`SessionState` 新增：

```ts
type ShellMode = 'kumiko' | 'terminal';
interface ShellState { mode: ShellMode; cwd: string }
```

默认 `{ mode: 'terminal', cwd: '' }`。

| 状态 | project | mode | cwd | 行为 |
| --- | --- | --- | --- | --- |
| 刚启动 / `switch /` | 无 | terminal | `''` | 命令在远端根目录执行，`cd` 自由 |
| `switch <project>[:branch]` | 有 | kumiko | `projects/<name>` | 命令固定在工作区根，`cd` 禁用，提示符 `project:/branch` |
| `switch current -terminal` | 保留 | terminal | `projects/<name>` | 从工作区根开始自由浏览，提示符 `/[cwd]` |
| `switch current -kumiko` | 保留 | kumiko | `projects/<name>` | 回到工作区模式 |

### 3.3 提示符

`ui.ts` 的 `contextFragment()`：

- 第一段永远是 `server`（青色）；
- kumiko 模式：`project`（绿色）+ `:/branch`（洋红），本地未同步时显示 `*project`（黄色）；
- terminal 模式：`/cwd`（青色），根目录不显示；
- 命令前缀：kumiko 命令使用各自 `promptPrefix`（默认 `KUMIKOCLI`，洋红粗体）；原生命令按
  `nativeLabel()` 取 `GIT` / `NPM` / `LINUX` 等（蓝色粗体），输出首行与提示符同色对齐。

`Repl` 增加了流式渲染接口 `beginStream()/writeStream(chunk)/endStream()`：远端输出按行到达，
第一行接在提示符后，后续行按提示符可见宽度补空格对齐（和 `sayLines` 的树状输出风格一致）。

## 4. 代码改动清单

新增：

- `src/shell.ts` — 虚拟路径、tokenize、原生命令执行、`ls` 树渲染、`cd`、COMMOND NOTICE；
- `src/commands/commond.ts` — `commond` 命令；
- `docs/terminal-mode.md` — 本文档。

修改：

- `src/types.ts` — `ShellMode` / `ShellState`，`SessionState.shell`，`ProjectConfig.settings`；
- `src/config.ts` — `.kumiko.toml` 的 `[settings]` 读写；
- `src/ui.ts` — `contextFragment()` 支持 terminal cwd；
- `src/repl.ts` — 命令分发：kumiko 命令 → 内置；`cd` → 虚拟目录；其余 → 远端 shell；
  流式输出渲染；执行前可选剥离行首 `kumiko`；
- `src/commands/session.ts` — `switch /`、`switch current -terminal|-kumiko`、成功后写 shell 状态；
- `src/commands/setting.ts` — 新增 `commond` 设置；
- `src/commands/registry.ts` — 注册 `commond`；
- `src/commands/misc.ts` — `help` 增加终端/commond 说明，`status` 增加 shell 行；
- `README.md` — 增加「常态命令行」小节。

## 5. 边界与安全

- **无 server**：原生命令直接报 `no server connected. run \`connect <server>\` first ...`，
  不做本地回退（避免「同一条命令在本地/远端语义不一致」）；
- **工作区未同步**：kumiko 模式下原生命令报 `the workspace '<name>' is not on the server yet.
  run \`sync\` first, or \`switch current -terminal\` ...`；`switch current -terminal` 在已连接
  服务器时会阻止进入未同步的工作区；
- **路径逃逸**：虚拟根内的 `..` 不能越过根（`resolveVirtualPath` 返回 `null` 并报
  `'...' is outside the shell root ($HOME/kumiko).`）；绝对路径从虚拟根解析；
- **命令内容**：原生命令本身是开发者显式输入，不做白名单/拦截（与真实终端一致）；
  Agent 场景下的危险命令审计作为后续项；
- **交互式命令**：当前是「一次性 exec」模型，不支持 `vim`、`top` 这类需要 PTY 的程序，
  长驻进程继续交给 `run`；后续可用 ssh2 的 pty shell 支持；
- **设置作用域**：`commond` 存在项目 `.kumiko.toml` 中，按项目开关；NOTICE 判定还要求远端
  worktree 中实际存在 `.kumiko.toml`（以 `test -f` 校验并缓存）。

## 6. 开放问题

1. **`commond` 的精确语义**：request 里 `kumiko commond` 与 `kumiko setting commond` 同时出现，
   疑似 `command` 的笔误。当前实现把它解释为「常用 git 命令包装 + repo 内 NOTICE 的开关」，
   如果本意是别的（例如设置项名应为 `notice`、或 `commond` 是展示命令面板），需要再调整；
2. **虚拟根选 `$HOME/kumiko` 还是 `$HOME`**：选前者才能让 `switch current -terminal` 显示
   `/projects/testProject`（与 request 一致），但 request 里空工作区 `[/]` 的示例内容
   （mc-server / node_modules / package.json / projects）更像 `$HOME`。当前按路径证据选前者；
   也可以后续做成可配置项；
3. **是否需要本地终端模式**（`terminal -local` / `-remote`）：当前按「远端执行」实现，
   README 截图里 CLI 在本机 Windows 上运行，若用户想用本地 shell，需要再加一个执行后端；
4. **PTY 与常驻 shell**：一次性 exec 无法保持 `export`/`cd` 之外的 shell 状态，也无法跑交互式
   程序；后续可以复用一条 ssh shell channel + sentinel 协议实现「真终端」；
5. **`switch /` 是否需要清空 server 上下文**：当前只清工作区，保留 server（与 request 演示一致）。

## 7. 更多想法

- **`kumiko exec <cmd>`** 与 `kumiko term` 子命令：给脚本/Agent 一个显式入口，避免依赖「未知命令透传」；
- **`--json` / 稳定退出码**：方便 IDE、Agent 与 CI 解析（`kumiko status --json` 等）；
- **命令审计日志**：把透传命令写入 `~/.kumiko/logs` 或远端 `logs/command.log`，Agent 场景可追溯；
- **危险命令确认**：`rm -rf`、`git reset --hard`、`git push --force` 等模式加 WARNING 确认；
- **本地/远端双后端**：`terminal` 模式区分 local shell 与远程 shell，甚至在 `server` 断开时本地可用；
- **Tab 补全与持久 history**：补全 kumiko 命令、项目名、分支名和远端路径；readline history 落盘；
- **提示符增强**：可选的 git dirty 标记、`run` 会话标记、超过若干字符的 cwd 缩略显示；
- **PTY 真终端**：`terminal` 进入后接管 stdin/stdout 转发到远端 pty，退出用 `exit`/Ctrl-D 回到 kumiko；
- **多 server**：`switch -server <name>` 时同步切换 shell 上下文与虚拟根；
- **文档**：README/快速开始里补终端模式示例截图，并把 `request.md` 的行为固化成端到端 smoke 脚本。

## 8. 验证方式与当前状态

已完成的验证：

- `npm run build`（`tsc -p tsconfig.json`，strict / NodeNext）编译通过，生成完整 `dist/`；
- 纯函数单测（临时脚本）：`tokenize`（含 Windows 路径与引号）、`resolveVirtualPath`（`~`、`..`、
  绝对路径、越界）、`nativeLabel`、`displayCwd`、`repoRootFor`、`contextFragment` 四种提示符形态；
- 远端命令字符串用 Git Bash 实测：`cd "$HOME/kumiko"/'projects/testProject' && bash -lc '<cmd>'`
  的嵌套引号、目录校验、`ls -1Ap` 输出解析均正确；
- pipe stdin 冒烟：`switch` / `switch current -terminal|-kumiko` / `switch /` / `cd`（工作区禁用）/
  `status` 的提示符与状态流转符合 request 预期；
- **mock SSH 端到端验证 19/19 PASS**：临时脚本用 ssh2 `Server` 模拟一台 Linux 服务器（exec 转发到
  本机 Git Bash，伪造 `$HOME/kumiko` 布局与本地 `~/.kumiko`），完整跑通 request 演示链路：
  `connect` → `switch <path>:/main`（提示符 `testProject:/main`）→ 工作区 `ls` 树 → `git -v`
  （`GIT` 前缀 + NOTICE）→ 工作区 `cd src` 报禁用错误 → `switch current -terminal`
  （提示符 `/projects/testProject`）→ `ls` / `git -v` / `git push`（`Everything up-to-date`）
  → `switch current -kumiko` → `commond status|log` → `setting` → `switch /`（根 `[/]` 树）
  → `cd projects` / `cd testProject`（自由 cwd）→ `exit`（退出码 0）。

待补充（本机无法完成）：

- 真实服务器端到端验证：探测时 `192.168.31.153:22` 的 sshd 在 banner exchange 阶段超时
  （此前一次 `ls $HOME/kumiko` 挂起后服务端 ssh 通道异常，TCP 端口本身可达），需要服务器恢复后再跑：
  `connect home` → `switch F:\Projects\deepseek-sage-client:/main` → `ls` / `git -v` /
  `switch current -terminal` / `git push` 的完整链路，确认远端真实输出与 NOTICE 行为。

补充说明：非 TTY（管道）模式下，`Repl` 在 stdin EOF 后会把 `closed` 置真，之后静默命令不再回显
提示符（原本行为，仅影响脚本化输出，不影响 TTY 交互）；mock e2e 的断言已按此容忍。

