@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" (
  copy ".env.example" ".env" >nul
)
echo.
echo 如果还没配置，请先打开本目录里的 .env 填写 MySQL；DeepSeek Key 可在页面里由用户自己配置。
echo 当前目录：%cd%
echo.
set PORT=5175
echo 正在启动服务：http://localhost:%PORT%
echo 请保持这个窗口打开，关闭窗口服务就会停止。
start "" "http://localhost:%PORT%"
node server.js
echo.
echo 服务已退出。如果这里显示错误，请把上面的错误发给我。
pause
