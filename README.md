# KUMIKO CLI
以Git为脚手架的远程构建工具链。简单、易于上手、可拓展的Remote Dev选择。
<p align="center">
  <img src="./docs/kumikocil-logo.png" alt="KUMIKO CLI" width="400" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black">
  <img src="https://img.shields.io/badge/Ubuntu_Server-E95420?style=for-the-badge&logo=ubuntu&logoColor=white">
  <img src="https://img.shields.io/badge/Tabby_Terminal-000000?style=for-the-badge&logo=windowsterminal&logoColor=white">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white">
  <img src="https://img.shields.io/badge/OpenSSH-222222?style=for-the-badge&logo=openssh&logoColor=white">
  <img src="https://img.shields.io/badge/Git-F05032?style=for-the-badge&logo=git&logoColor=white">
</p>

KUMIKO CLI是基于Node.js开发的远程构建工具链。它使用了Git为脚手架，适合在Linux Server中运行，并通过OpenSSH对服务器进行管理。

## Quick Start 快速开始
如要快速开始，请克隆该仓库到一个空目录中。
```Bash
git clone https://github.com/OmaeKumiko529/kumiko-cli.git
```

确保你的环境安装了Node.js，然后通过以下指令构建并运行：
```Bash
npm install
npm run build
node dist/cli.js
```

随后，你就进入了KUMIKO CLI。
![alt text](image.png)