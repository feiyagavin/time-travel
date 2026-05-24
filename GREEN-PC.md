# 绿色 PC 端说明

绿色 PC 端复用当前网页端界面，但运行时不依赖 MySQL。用户解压后双击 `start-green-pc.cmd` 即可启动。

## 启动

```text
双击 start-green-pc.cmd
```

默认访问：

```text
http://localhost:5188
```

## 数据保存

绿色端会自动使用本地文件存档：

```text
pc-green/data/db.json
```

这个文件会保存本机用户、账号、旅程、聊天、任务、资金流水，以及用户自己配置的 DeepSeek API Key。

## DeepSeek 配置

用户登录后在界面里填写自己的 DeepSeek API Key。配置成功后会保存在当前账号里，下次打开绿色端会自动记住，不需要每次重新输入。

## 打包给用户

可以双击：

```text
build-green-pc.cmd
```

脚本会生成：

```text
pc-green-release/
```

打包目录包含这些内容：

```text
server.js
public/
.env.example
start-green-pc.cmd
README.md
GREEN-PC.md
node.exe
```

不要把你自己的 `.env`、`data/`、日志文件一起打包给用户。

如果脚本没有找到 `node.exe`，用户电脑需要先安装 Node.js，或把 `node.exe` 手动放入绿色包目录。
