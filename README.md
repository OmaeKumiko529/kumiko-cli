# KUMIKO CLI

以 git 为脚手架的局域网远程构建 / 调试工具链。交互规格与目标以 [request.md](request.md) 为准，本仓库是实现。

## 当前状态

M0：REPL 交互骨架

- 常驻上下文 prompt（`KUMIKOCLI` / 命令名前缀、`*` 本地、`: /branch` 分支）
- `server create | list | test`
- `connect <server>`
- `switch <project>[:branch]`
- `status`
- `help` / `exit`

之后按 request 的交互逻辑推进：`sync`（含 unconfigured 项目的 create 向导）→ `build` → `pull` → `logs` → `new branch`。

## 开发

```bash
npm install
npm run build
npm link     # 之后直接 kumiko
kumiko
```

全局配置在 `~/.kumiko/config.toml`（服务器列表，不入仓库）。
项目配置 `.kumiko.toml` 提交进项目仓库，随 sync 同步到服务器，记录工具链（solution / run / build / test）。
