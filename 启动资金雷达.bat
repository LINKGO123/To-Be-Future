@echo off
chcp 65001 >nul
rem ============================================================
rem  资金雷达工作台 · 家人模式一键启动（刀4）
rem  双击运行：注入 bundled node → 启动 API 与界面 →
rem  等健康检查通过 → 打开 http://127.0.0.1:5930 → 保持运行。
rem  关闭本窗口或按 Q 回车 = 停止全部服务（按进程树清理）。
rem  也可运行：启动资金雷达.bat --check（只检查路径，不启动任何服务）
rem ============================================================
setlocal EnableExtensions
set "NODE_DIR=C:\Users\刘德华\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin"
set "NODE=%NODE_DIR%\node.exe"
set "PNPM=C:\Users\刘德华\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
set "ROOT=%~dp0"

rem 注入 bundled node 到 PATH（后面的健康检查与子进程都走这一份）
set "PATH=%NODE_DIR%;%PATH%"

if /i "%~1"=="--check" goto check

echo ============ 资金雷达工作台 · 家人模式 ============
echo bundled node：
"%NODE%" --version
cd /d "%ROOT%"

rem 刷新本机访问令牌：旧令牌已收紧权限，非提权进程再次收紧会报 SeSecurityPrivilege、
rem 导致 API 起不来；删除后 API 会重新生成并收紧成功（令牌仅本机校验用，每次启动随机）。
if exist "%ROOT%.local\api.token" (
  del /q "%ROOT%.local\api.token"
  echo 已刷新本机访问令牌（API 启动时会重新生成）
)

rem 启动 API（orchestrator\src\api.ts，端口 8765，只在本机）
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Start-Process -FilePath '%NODE%' -ArgumentList 'orchestrator\src\api.ts','--port','8765','--host','127.0.0.1' -WorkingDirectory '%ROOT%' -PassThru -NoNewWindow).Id"') do set "API_PID=%%i"
if not defined API_PID goto apistartfail
echo API 已启动（PID %API_PID%）

rem 启动界面（node pnpm.mjs --dir desktop run dev，端口 5930）
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Start-Process -FilePath '%NODE%' -ArgumentList '%PNPM%','--dir','desktop','run','dev' -WorkingDirectory '%ROOT%' -PassThru -NoNewWindow).Id"') do set "UI_PID=%%i"
if not defined UI_PID goto uistartfail
echo 界面已启动（PID %UI_PID%）

echo 等待服务就绪（首次启动约 10-30 秒）…
set /a tries=0
:wait
set /a tries+=1
if %tries% GTR 120 goto timeout
timeout /t 1 /nobreak >nul
tasklist /FI "PID eq %API_PID%" /NH 2>nul | findstr /C:"%API_PID%" >nul || goto apidown
tasklist /FI "PID eq %UI_PID%" /NH 2>nul | findstr /C:"%UI_PID%" >nul || goto uidown
node orchestrator\src\startup_health.ts >nul 2>&1
if errorlevel 1 goto wait

echo 服务就绪：正在打开 http://127.0.0.1:5930
start "" http://127.0.0.1:5930
echo.
echo ============================================================
echo  资金雷达已启动（家人模式）
echo  关闭本窗口，或按 Q 回车，即停止 API 与界面。
echo ============================================================

:hold
choice /C QN /T 3 /D N /N >nul
if errorlevel 2 (
  tasklist /FI "PID eq %API_PID%" /NH 2>nul | findstr /C:"%API_PID%" >nul || goto apidown
  tasklist /FI "PID eq %UI_PID%" /NH 2>nul | findstr /C:"%UI_PID%" >nul || goto uidown
  goto hold
)
goto shutdown

:apistartfail
echo [失败] 无法启动 API（Start-Process 未返回进程号）。请检查上方报错。
pause
exit /b 1

:uistartfail
echo [失败] 无法启动界面（Start-Process 未返回进程号）。正在关闭 API…
taskkill /PID %API_PID% /T /F >nul 2>&1
pause
exit /b 1

:apidown
echo.
echo API 进程已退出（端口冲突或产品配置问题）。正在关闭界面…
taskkill /PID %UI_PID% /T /F >nul 2>&1
echo 上方日志有详细原因；排查后可再次双击启动。
pause
exit /b 1

:uidown
echo.
echo 界面进程已退出。正在关闭 API…
taskkill /PID %API_PID% /T /F >nul 2>&1
echo 请检查 5930 端口是否被占用；上方日志有详细原因。
pause
exit /b 1

:timeout
echo.
echo 启动等待超过 4 分钟仍未就绪。正在关闭 API 与界面…
taskkill /PID %UI_PID% /T /F >nul 2>&1
taskkill /PID %API_PID% /T /F >nul 2>&1
echo 请检查上方日志、8765/5930 端口以及产品配置。
pause
exit /b 1

:shutdown
echo.
echo 正在关闭资金雷达（API 与界面）…
taskkill /PID %UI_PID% /T /F >nul 2>&1
taskkill /PID %API_PID% /T /F >nul 2>&1
echo 已全部关闭。
timeout /t 2 /nobreak >nul
exit /b 0

:check
echo 检查 bundled node：%NODE%
if not exist "%NODE%" ( echo [失败] 找不到 node.exe & exit /b 1 )
echo 检查 pnpm：%PNPM%
if not exist "%PNPM%" ( echo [失败] 找不到 pnpm.mjs & exit /b 1 )
echo 检查项目目录：%ROOT%
if not exist "%ROOT%orchestrator\src\api.ts" ( echo [失败] 找不到 orchestrator\src\api.ts & exit /b 1 )
if not exist "%ROOT%desktop\package.json" ( echo [失败] 找不到 desktop\package.json & exit /b 1 )
echo node 版本：
"%NODE%" --version
echo [OK] 启动脚本与依赖路径就绪（未启动任何服务）。
exit /b 0
