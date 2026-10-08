#!/usr/bin/env bash
# 数据层冒烟：确认便携 Python 依赖齐全 + 核心取数端点返回真实数据。
# 用途：打包后（或改运行时后）做一次「点开看数据」级别的验收，
#       避免只验「能启动」却漏掉数据层缺依赖（如 requests）这类问题。
# 用法：
#   bash scripts/smoke-fetch.sh --python <便携 python 路径>                 # 只验依赖
#   bash scripts/smoke-fetch.sh --base http://127.0.0.1:8765 --token <t>    # 只验收取数端点
#   bash scripts/smoke-fetch.sh --base http://127.0.0.1:8765 --auto         # 自动从后端进程读 token（Mac/Linux）
set -uo pipefail

PYTHON=""
BASE=""
TOKEN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --python) PYTHON="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --auto) BASE="http://127.0.0.1:8765"; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$PYTHON" ] && [ -z "$BASE" ]; then
  echo "用法: bash scripts/smoke-fetch.sh [--python <p>] [--base <url> --token <t> | --auto]" >&2
  exit 2
fi

fail=0

# 1) 依赖齐全（语音 + 数据层）
if [ -n "$PYTHON" ]; then
  echo "== 便携 Python 依赖检查 =="
  if "$PYTHON" -c 'import sherpa_onnx, numpy, requests, pandas, lxml, akshare, baostock, mootdx' >/dev/null 2>&1; then
    echo "  ✓ 语音依赖 + 数据层依赖均可 import"
  else
    echo "  ✗ 依赖缺（数据层取数会失败）—— 检查 download-mac-runtime.sh 是否装了 data-access requirements.txt"
    fail=1
  fi
fi

# 2) 核心取数端点（首页 / 主线雷达 / 复盘 / 龙虎榜依赖）
if [ -n "$BASE" ]; then
  if [ -z "$TOKEN" ]; then
    BPID=$(pgrep -f "orchestrator/src/api.ts --port" | head -1 || true)
    TOKEN=$(ps eww "$BPID" 2>/dev/null | tr ' ' '\n' | sed -n 's/^VRA_API_TOKEN=//p' | head -1 || true)
    if [ -z "$TOKEN" ]; then echo "拿不到 token，请用 --token 显式传" >&2; exit 2; fi
  fi
  echo "== 核心取数端点（无参，默认当天）=="
  for ep in em_zt_pool em_zb_pool em_limit_up_sentiment em_daily_dragon_tiger em_board_fund_flow; do
    res=$(curl -s -X POST "$BASE/fetch" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --max-time 45 -d "{\"endpoint\":\"$ep\"}" 2>/dev/null)
    st=$(printf '%s' "$res" | python3 -c "import sys,json;print(json.load(sys.stdin)['envelope']['status'])" 2>/dev/null || echo "?")
    n=$(printf '%s' "$res" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['envelope'].get('evidence',[])))" 2>/dev/null || echo "0")
    if [ "$st" = "ok" ] && [ "$n" != "0" ]; then
      echo "  ✓ $ep: ok（$n 条）"
    else
      echo "  ✗ $ep: status=$st evidence=$n"
      fail=1
    fi
    sleep 1   # 东财 push2 系共用风控面，端点间留 1 秒，避免冒烟本身触发限流
  done
fi

echo ""
if [ "$fail" = "0" ]; then
  echo "数据层冒烟通过"
else
  echo "数据层冒烟失败（见上方 ✗）"
  exit 1
fi
