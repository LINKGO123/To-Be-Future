# ============================================================
# 资金雷达工作台 · 家人模式一键启动（刀4）
# ------------------------------------------------------------
# 1. 把 bundled node 注入 PATH（本机 DSH 运行时，不依赖系统安装）；
# 2. 依次启动 API（node orchestrator\src\api.ts --port 8765 --host 127.0.0.1）
#    与 UI（node <pnpm.mjs> --dir desktop run dev，固定端口 5930）；
# 3. 经界面代理跑健康检查（orchestrator\src\startup_health.ts）直到通过；
# 4. 打开 http://127.0.0.1:5930 并保持运行；任一进程退出时按进程树清理（见 scripts\start.ps1）。
# 双击 .bat 或运行本脚本均可；PowerShell 执行策略请用 -ExecutionPolicy Bypass。
# ============================================================
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir = "C:\Users\刘德华\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin"
$node = Join-Path $nodeDir "node.exe"
$pnpm = "C:\Users\刘德华\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

if (-not (Test-Path $node)) { throw "找不到 bundled node.exe：$node（请检查 DSH 运行时是否完整）" }
if (-not (Test-Path $pnpm)) { throw "找不到 pnpm.mjs：$pnpm（请检查 DSH 运行时是否完整）" }
if (-not (Test-Path (Join-Path $root "orchestrator\src\api.ts"))) { throw "找不到 orchestrator\src\api.ts：$root 不是项目根目录？" }
if (-not (Test-Path (Join-Path $root "desktop\package.json"))) { throw "找不到 desktop\package.json：$root 不是项目根目录？" }

# 注入 bundled node 到 PATH（健康检查脚本与后续子进程都走这一份）
$env:PATH = "$nodeDir;$env:PATH"

# 本机实测（非提权进程）：已收紧权限的旧 api.token 再次收紧会报 SeSecurityPrivilege（Set-Acl 拒绝），
# 导致 API 起不来。启动前刷新令牌：删掉旧的，API 会重新生成并收紧成功（每启动一个随机令牌，仅本机校验用，Vite 每次请求都会重读）。
$tokenFile = Join-Path $root ".local\api.token"
if (Test-Path $tokenFile) {
  Remove-Item -LiteralPath $tokenFile -Force
  Write-Host "已刷新本机访问令牌（API 启动时会重新生成）"
}

Write-Host "资金雷达工作台 · 家人模式启动中…"
Write-Host "node: $(& $node --version) | 项目: $root"

$api = $null
$ui = $null

# 进程树清理（与底座 scripts\start.ps1 同款：CIM 快照找子孙 + taskkill /T）
function Stop-ProcessTree($Process) {
  if (-not $Process) { return }
  $rootId = [int]$Process.Id
  $all = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId)
  $pending = [System.Collections.Generic.Queue[int]]::new()
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $descendants = [System.Collections.Generic.List[int]]::new()
  $pending.Enqueue($rootId)
  [void]$seen.Add($rootId)
  while ($pending.Count -gt 0) {
    $parentId = $pending.Dequeue()
    foreach ($child in $all) {
      $childId = [int]$child.ProcessId
      if ([int]$child.ParentProcessId -eq $parentId -and $seen.Add($childId)) {
        $descendants.Add($childId)
        $pending.Enqueue($childId)
      }
    }
  }
  foreach ($targetId in @($descendants | Sort-Object -Descending)) {
    & taskkill.exe /PID $targetId /T /F *> $null
  }
  $Process.Refresh()
  if (-not $Process.HasExited) {
    & taskkill.exe /PID $rootId /T /F *> $null
  }
}

try {
  $api = Start-Process -FilePath $node -ArgumentList @("orchestrator\src\api.ts", "--port", "8765", "--host", "127.0.0.1") -WorkingDirectory $root -PassThru -NoNewWindow
  $ui = Start-Process -FilePath $node -ArgumentList @($pnpm, "--dir", "desktop", "run", "dev") -WorkingDirectory $root -PassThru -NoNewWindow

  Write-Host "等待服务就绪（首次启动约 10-30 秒）…"
  $ready = $false
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $readyDeadline) {
    $api.Refresh()
    $ui.Refresh()
    if ($api.HasExited) { throw "API 启动失败（退出码 $($api.ExitCode)），请检查 8765 端口和产品配置。" }
    if ($ui.HasExited) { throw "界面启动失败（退出码 $($ui.ExitCode)），请检查 5930 端口是否被占用。" }
    # 经界面代理验证后端鉴权；令牌仍只留在本地服务，不传到浏览器或命令参数
    & $node (Join-Path $root "orchestrator\src\startup_health.ts")
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "启动等待超过 90 秒。请检查上方日志、8765/5930 端口以及产品配置；浏览器尚未打开。" }
  $api.Refresh()
  $ui.Refresh()
  if ($api.HasExited) { throw "API 启动失败（退出码 $($api.ExitCode)），请检查 8765 端口和产品配置。" }
  if ($ui.HasExited) { throw "界面启动失败（退出码 $($ui.ExitCode)）。" }

  Write-Host "服务就绪：正在打开 http://127.0.0.1:5930"
  Start-Process "http://127.0.0.1:5930"
  Write-Host "资金雷达已启动。关闭本窗口即停止 API 与界面。"

  while (-not $api.HasExited -and -not $ui.HasExited) {
    Start-Sleep -Milliseconds 250
    $api.Refresh()
    $ui.Refresh()
  }
  if ($api.HasExited) { throw "API 已停止（退出码 $($api.ExitCode)），界面同步关闭。" }
  if ($ui.HasExited) { throw "界面已提前停止（退出码 $($ui.ExitCode)）。" }
} finally {
  Stop-ProcessTree $ui
  Stop-ProcessTree $api
  Write-Host "已清理全部进程。"
}
