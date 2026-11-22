# KUMIKO CLI

以 git 为脚手架的局域网远程构建 / 调试工具链。交互规格与目标以 [request.md](request.md) 为准，本仓库是实现。

## 当前状态

M0：REPL 交互骨架

- 常驻上下文 prompt（`KUMIKOCLI` / 命令名前缀、`*` 本地、`:/branch` 分支）
- `server create | list | test | remove`
- `connect <server>`
- `switch <project>[:branch]`
- `status` / `help` / `exit`

M1：sync + logs

- `sync [commit] [-server <name>] [--force]`
  - 未配置项目自动进入 create 向导：solution / run / build → 写 `.kumiko.toml` → `git init` main → 远端裸库 + 工作树 → `Initial commit`
  - 普通 sync：提交 → push → 更新远端工作树，Done 文案与 request.md 一致
  - `--force` 需要手输分支名最后一段确认（`main/dev` 输 `dev`）
- `logs`：本地同步历史（`~/.kumiko/history/<project>.jsonl`）
- `logs check <sha>`：单次同步的改动文件树

M2：build

- `build [-server <name>] [-artifacts]`
  - 读本地 `.kumiko.toml` 的 `[build].command`，在远端工作树上执行（输出流式回显）
  - 默认 Done 文案指向远端产物 `@/<artifacts>`（`[build].artifacts` 默认 `dist`）
  - `-artifacts` 用 SFTP 把远端产物拉回本地 `*@/<artifacts>`
  - 失败时报告退出码；构建产物是 untracked，不算远端工作树 dirty

M3：pull

- `pull [branch] [-server <name>] [--force]`
  - 服务器工作树上的 tracked 改动先提交（`kumiko: server changes <time>`）并 push 到裸库
  - 本地 fetch + fast-forward；`--force` 手输分支名确认后 `reset --hard` 覆盖本地
  - Done 文案 `Done! Pull <n> file(s) from <project>:/<branch>.`
  - 本地有未提交改动时非 `--force` 拒绝；服务器工作树在别的分支时拒绝

M4：分支树（显示路径）

- `.kumiko.toml` 增加 `[branches]`（子分支 ref = 父分支 ref）与 `[branch] syncChildren`
- `branch new /<parent>/<child>`：从当前父分支创建本地分支与远端分支、记录 `[branches]`，输出 `Done! New branch /main/dev`
- `switch <project>:/<parent>/<child> [--carry]`：按显示路径切换；`--carry` 允许携带未提交改动
- `branch merge <child> to <parent>`：服务器端把子分支合并进父分支并推回，本地父分支 fast-forward；Done 使用 `BRANCH` 前缀
- 父分支 `sync`：有子分支且 `syncChildren` 开启时，先打印 NOTICE 并输入父分支名确认，再把父 commit 合并进子分支（保留子提交，冲突中止）
- `setting` / `setting syncChildren on|off`：查看 / 写入项目设置
- 显示路径与 git ref：`main/dev` 是显示路径，底层 git ref 是 `dev`，父级关系存在 `.kumiko.toml [branches]`

M5：run（远程运行 + 端口转发）

- `run [-server <name>] [--port <local>] [--remote-port <remote>]`
  - 把远端工作树同步到当前分支后，在服务器运行 `.kumiko.toml [run].command`
  - 远端端口取 `[run].port`（默认 5173），本地监听同端口或 `--port` 指定；本地端口 → 服务器端口 TCP 转发
  - 远端日志流式回显（前缀 `run | `），进程用 `setsid` 独立会话启动，退出 REPL 时自动收掉
- `run stop`：结束远端进程、关闭转发
- `run status` / `status`：查看当前 run 会话
- Ctrl-C 在空闲时也会收掉 run 会话

远端布局（服务器）：`~/kumiko/repos/<project>.git`（裸库）+ `~/kumiko/projects/<project>`（工作树）+ `~/kumiko/logs/<project>.run.log`。

request.md 里的命令到这里已全部实现：sync / build / pull / run / branch new / branch merge / setting / logs / server / connect / switch / status。

## 开发

```bash
npm install
npm run build
npm link     # 之后直接 kumiko
kumiko
```

## 测试

```bash
npm run build
node dev/smoke.mjs       # M0：server create / connect / switch / status
node dev/smoke-sync.mjs  # M1：sync create 向导 / push / force 确认 / logs
node dev/smoke-build.mjs # M2：build / -artifacts 拉回
node dev/smoke-pull.mjs  # M3：拉回服务器改动 / --force 覆盖本地
node dev/smoke-branch.mjs # M4：branch new / switch 显示路径 / branch merge / 父分支下发 / setting
node dev/smoke-run.mjs    # M5：run 远端进程 / 本地端口转发 / run stop
```

六个冒烟脚本都需要能免密 `ssh` 到测试服务器，并在结束后清理服务器上的临时仓库。

## 配置

- 全局：`~/.kumiko/config.toml`（服务器列表与 ssh key，不入仓库、权限 0600）
- 项目：`.kumiko.toml` 提交进项目仓库，随 sync 同步到服务器，记录工具链（solution / run / build / test）与分支树（`[branches]` / `[branch] syncChildren`）
