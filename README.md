# Time Travel App

一个由 DeepSeek 驱动的文字穿越人生模拟原型，包含网页端和移动端 H5。玩家可以创建账号、配置自己的 DeepSeek API Key、选择时代与身份，在历史约束下推进剧情、任务、资金、健康和人生时间线。

## 功能

- 网页端用户体验与管理后台
- 移动端 H5，位于 `mobile-unibest`
- 绿色 PC 端，本地文件存档，不依赖 MySQL
- 用户注册、登录、独立旅程存档
- 用户自行配置 DeepSeek API Key，配置一次后账号内保存
- 时间线按年月日推进，任务选项带合理耗时
- 现金、负债、收入、生活支出和资金流水
- 生存状态、健康、声望、学识、人际等属性
- 管理后台查看用户、旅程、日志和资金记录

## 环境要求

- Node.js 18 或更高版本
- MySQL 8 或兼容版本
- DeepSeek API Key

## 配置

复制 `.env.example` 为 `.env`，然后按自己的环境填写：

```text
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=time_travel_app
```

现在推荐用户在页面里自己填写 DeepSeek API Key。服务端的 `DEEPSEEK_API_KEY` 可以留空，只作为默认配置备用。

## 启动网页端

```bash
npm install
npm start
```

打开：

```text
http://localhost:5175
```

## 启动移动端 H5

```bash
cd mobile-unibest
npm install
npm run dev:h5
```

默认打开：

```text
http://localhost:5199
```

## 启动绿色 PC 端

绿色 PC 端不依赖 MySQL，数据保存在本机文件里：

```bash
start-green-pc.cmd
```

默认打开：

```text
http://localhost:5188
```

生成绿色发布包：

```bash
build-green-pc.cmd
```

详细说明见 `GREEN-PC.md`。

## 演示账号

- 管理员默认账号：`admin / admin123`
- 普通用户可以直接注册

首次公开部署前，请务必修改管理员密码。

## 数据说明

运行时会使用 MySQL 中的 `tt_*` 表保存用户、会话、旅程、任务、聊天记录、属性日志和资金流水。

本地调试产生的 `.env`、`data/`、日志、npm 缓存、构建产物都已加入 `.gitignore`，不要提交到公开仓库。

## 开源提醒

公开到 GitHub 前，请确认：

- `.env` 没有被提交
- 数据库密码、API Key、真实用户数据没有出现在代码或文档里
- `data/db.json`、日志文件、缓存目录没有被提交
- 已选择合适的开源协议，例如 MIT
