#!/usr/bin/env bash
# 一键：登录 GitHub → 推送 → 开启 Pages
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 检查登录状态"
if ! gh auth status >/dev/null 2>&1; then
  echo "将打开浏览器，请在网页里授权 GitHub…"
  gh auth login -h github.com -p https -w
fi

echo "==> 推送代码到 origin/main"
git branch -M main
git push -u origin main

echo "==> 尝试开启 GitHub Pages（目录 /web）"
# 免费账号：Private 仓库通常无法开 Pages，需改为 Public，或改用其他静态托管
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  "/repos/hujjmya/kuromi-checkin/pages" \
  -f "build_type=legacy" \
  -f "source[branch]=main" \
  -f "source[path]=/web" \
  && echo "Pages 已创建" \
  || echo "Pages API 调用失败（若仓库是 Private，请到网页改为 Public 后再开 Pages）"

echo ""
echo "网页地址（开启成功后约 1–2 分钟生效）："
echo "  https://hujjmya.github.io/kuromi-checkin/"
echo ""
echo "然后到 Supabase → Authentication → URL Configuration："
echo "  Site URL = https://hujjmya.github.io/kuromi-checkin/"
