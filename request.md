# KUMIKO CLI
Kumiko CLI是一个凭借git作为脚手架、通过在本地编写代码、上传到内网服务器进行编译调试的工具链。它通过命令行的方式被注册到IDE或服务器中，并通过一系列指令优化对于Agent的友好程度。

## Quick Plan 概述
Kumiko CLI将会有一下几个基础指令：
```Bash
# 同步本地代码到服务器
kumiko sync [commit] [-server]

# 通过所配置的方式构建当前项目
kumiko build [-serverName]

# 拉取服务器分支上的云端代码到本地
kumiko pull [branch]

# 查看日志
kumiko logs
```

`-server`参数接受不同于当前选中的服务器。需要事先通过`kumiko server create`创建。你可以通过下列示例来了解基本的用法：

```Bash
KUMIKOCLI $> kumiko server create
SERVER $> serverName: personalServer2
SERVER $> ssh: testuser@192.168.0.2
SERVER $> password: ******
SERVER $> test ssh in 192.168.0.2 of testuser...
SERVER $> Done! use `server list` to check your new server.
KUMIKOCLI $> kumiko server list
SERVER $> personalServer:testuser@192.168.0.1
          personalServer2:testuser@192.168.0.2
KUMIKOCLI $> kumiko server test
SERVER $> [*] personalServer:testuser@192.168.0.1
          [X] personalServer2:testuser@192.168.0.2
           └─ Connection not responding.
          [X] personalServer3:testuser@192.168.0.3
           ├─ Git is unavailable.
           └─ Docker is unavailable.
KUMIKOCLI $> kumiko connect personalServer
KUMIKOCLI personalServer $> kumiko switch testProject
# 虽然此处switch testProject，但是server中并不存在testProject，testProject只在本地存在。所以会被显示为*testProject。sync会自动进入create流程。
KUMIKOCLI personalServer *testProject$> kumiko sync

SYNC personalServer $> Unconfigured project 'testProject'.

SYNC personalServer $> Load a configured solution or create a new solution[l/c]
# 假设create
SYNC personalServer $> c

SYNC personalServer $> solutionName: Vue
SYNC personalServer $> Configure `kumiko run`: npm run
SYNC personalServer $> Configure `kumiko build`: npm build
SYNC personalServer $> Done! You can modify additional configuration options in *kumikocli/sol/vue.sol

SYNC personalServer $> Write .kumiko.toml at *testProject/
SYNC personalServer $> No Git configuration. Create repository as 'testProject'.
SYNC personalServer $> Initialize a main branch? [y/n]
SYNC personalServer $> y

KUMIKOCLI personalServer testProject:/main $> Done! Sync as 'Initial commit':1a2b3c4d.
KUMIKOCLI personalServer testProject:/main $> kumiko build
KUMIKOCLI personalServer testProject:/main $> Done! Build at @/dist remotely.
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main $> kumiko sync testsync
SYNC personalServer testProject:/main $> Done! Push 3 changed files to testProject:/main as 'testsync':1a2b3c4d.
KUMIKOCLI personalServer testProject:/main $> kumiko logs
LOGS personalServer testProject $> LOGS
                                   'testsync':1a2b3c4d
KUMIKOCLI personalServer testProject:/main $> kumiko logs check 1a2b3c4d
LOGS personalServer testProject $> LOGS
                                   [*] 'testsync':1a2b3c4d
                                   [*] Push 3 changed files to testProject:/main
                                    ├─ Scripts
                                    │  ├─ test.vue
                                    │  └─ App.vue
                                    └─ Engine
                                       └─ storyEngine.ts
KUMIKOCLI personalServer testProject:/main $> kumiko build -artifacts
KUMIKOCLI personalServer testProject:/main $> Done! Build at *@/dist locally.
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main $> kumiko new branch /main/dev
KUMIKOCLI personalServer testProject:/main $> Done! New branch /main/dev
KUMIKOCLI personalServer testProject:/main $> kumiko switch testProject:/main/dev --carry
KUMIKOCLI personalServer testProject:/main/dev $> kumiko sync devInitial
SYNC personalServer testProject:/main/dev $> Done! Push 2 changed files to testProject:/main/dev as 'devInitial':1a2b3c4d.
# 误删部分文件后
KUMIKOCLI personalServer testProject:/main/dev $> kumiko pull --force
PULL personalServer testProject:/main/dev $> WARNING --force will pull all files and OVERWRITE your current local workspace. Input branch name to OVERWRITE: dev
PULL personalServer testProject:/main/dev $> Done! Pull 325 files from testProject:/main/dev.
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main/dev $> kumiko sync testpush --force
SYNC personalServer testProject:/main/dev $> WARNING --force will push all files and OVERWRITE your current branch. Input branch name to OVERWRITE: dev
SYNC personalServer testProject:/main/dev $> Done! Push 325 files to testProject:/main/dev as 'testpush':1a2b3c4d.
```