```Bash
KUMIKOCLI $> kumiko server create
SERVER $> serverName: personalServer2
SERVER $> ssh: testuser@192.168.0.2
SERVER $> password: ******
SERVER $> test ssh in 192.168.0.2 of testuser...
SERVER $> DONE use `server list` to check your new server.
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
SYNC personalServer $> DONE You can modify additional configuration options in *kumikocli/sol/vue.sol

SYNC personalServer $> Write .kumiko.toml at *testProject/
SYNC personalServer $> No Git configuration. Create repository as 'testProject'.
SYNC personalServer $> Initialize a main branch? [y/n]
SYNC personalServer $> y

KUMIKOCLI personalServer testProject:/main $> DONE Sync as 'Initial commit':1a2b3c4d.
KUMIKOCLI personalServer testProject:/main $> kumiko build
KUMIKOCLI personalServer testProject:/main $> DONE Build at @/dist remotely.
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main $> kumiko sync testsync
SYNC personalServer testProject:/main $> DONE Push 3 changed files to testProject:/main as 'testsync':1a2b3c4d.
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
KUMIKOCLI personalServer testProject:/main $> DONE Build at *@/dist locally.
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main $> kumiko branch new /main/dev
KUMIKOCLI personalServer testProject:/main $> DONE New branch /main/dev
KUMIKOCLI personalServer testProject:/main $> kumiko switch testProject:/main/dev --carry
KUMIKOCLI personalServer testProject:/main/dev $> kumiko sync devInitial
SYNC personalServer testProject:/main/dev $> DONE Push 2 changed files to testProject:/main/dev as 'devInitial':1a2b3c4d.
# 误删部分文件后
KUMIKOCLI personalServer testProject:/main/dev $> kumiko pull --force
PULL personalServer testProject:/main/dev $> WARNING --force will pull all files and OVERWRITE your current local workspace. Input branch name to OVERWRITE: dev
PULL personalServer testProject:/main/dev $> DONE Pull 325 files from testProject:/main/dev.
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main/dev $> kumiko sync testpush --force
SYNC personalServer testProject:/main/dev $> WARNING --force will push all files and OVERWRITE your current branch. Input branch name to OVERWRITE: dev
SYNC personalServer testProject:/main/dev $> DONE Push 325 files to testProject:/main/dev as 'testpush':1a2b3c4d.

# 子分支与父分支特性与合并演示
KUMIKOCLI personalServer testProject:/main/dev $> kumiko branch merge /main/dev to /main
BRANCH personalServer testProject:/main/dev $> DONE /main/dev merged with /main.

KUMIKOCLI personalServer testProject:/main/dev $> kumiko switch testProject:/main
# 改动部分文件后
KUMIKOCLI personalServer testProject:/main $> kumiko sync
SYNC personalServer testProject:/main $> NOTICE By default running sync on a parent branch will cause the same sync content to be pushed to its child branches. To change this setting, use the kumiko setting commond. Input branch name to sync: main
SYNC personalServer testProject:/main $> DONE Push 2 changed files to testProject:/main and its child branches as 'test114514':1a2b3c4d.

# 常态命令行，接受默认linux命令
KUMIKOCLI personalServer testProject:/main $> cd src
KUMIKOCLI personalServer testProject:/main $> ERROR cd command cannot be used when a workspace and branch have been specified. # 无法在工作区指定终端工作目录，除非工作区为空。

KUMIKOCLI personalServer testProject:/main $> ls # 如果在工作区使用linux命令，就会默认终端工作目录位于工作区根目录
LINUX personalServer testProject:/main $> [*] testProject
                                           ├── readme.md
                                           ├── node_modules
                                           ├── package.json
                                           ├── src
                                           └── .git
KUMIKOCLI personalServer testProject:/main $> kumiko switch / # 回到空工作区
KUMIKOCLI personalServer $> ls # 使用linux命令
LINUX personalServer $> [/]
                         ├── mc-server
                         ├── node_modules
                         ├── package.json
                         └── projects
KUMIKOCLI personalServer $> cd mc-server # 此时就可以指定新的终端工作目录了
KUMIKOCLI personalServer /mc-server $> git -v #也可以使用经过PATH配置的CIL
GIT personalServer $> git version 2.53.0
KUMIKOCLI personalServer /mc-server $> kumiko switch testProject:/main
KUMIKOCLI personalServer testProject:/main $> kumiko switch current -terminal #可以快捷切换到当前工作区的根目录，方便你使用接近原生终端的方式读写
KUMIKOCLI personalServer /projects/testProject $> git -v
GIT personalServer $> git version 2.53.0
KUMIKOCLI personalServer /projects/testProject $> NOTICE A kumiko config include in repo. You can use kumiko commond to quickly get more efficient Git experience. To close this notice, use the kumiko setting commond.
KUMIKOCLI personalServer /projects/testProject $> kumiko switch current -kumiko
KUMIKOCLI personalServer testProject:/main $> git push # 同样可以使用原生git指令
GIT personalServer testProject:/main $> Everything up-to-date.
GIT personalServer testProject:/main $> NOTICE A kumiko config include in repo. You can use kumiko commond to quickly get more efficient Git experience. To close this notice, use the kumiko setting commond.
```