@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "data\db.json" (
  del "data\db.json"
  echo 已重置演示数据。下次启动会重新创建干净存档。
) else (
  echo 当前没有需要重置的数据。
)
pause
