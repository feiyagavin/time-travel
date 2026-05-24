$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PORT = "5175"
Write-Host "正在启动服务：http://localhost:5175"
Write-Host "请保持这个窗口打开，关闭窗口服务就会停止。"
Start-Process "http://localhost:5175"
node server.js
