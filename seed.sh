#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:8080}"
COOKIE=/tmp/onlineorder-cookie.txt
EMAIL="foo@mail.com"
PASSWORD="123456"

echo "==> 登录 $EMAIL"
code=$(curl -s -c "$COOKIE" -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/login" -d "username=$EMAIL&password=$PASSWORD")
[ "$code" = "200" ] || { echo "登录失败 HTTP $code" >&2; exit 1; }
echo "    OK"

echo "==> 加菜品到购物车"
added=0
for id in 1 2 3 4 5; do
  code=$(curl -s -b "$COOKIE" -o /dev/null -w '%{http_code}' \
    -X POST "$BASE/cart" -H 'Content-Type: application/json' -d "{\"menu_id\":$id}")
  if [ "$code" = "200" ]; then echo "    menu_id=$id OK"; added=$((added+1));
  else echo "    menu_id=$id 跳过 (HTTP $code)"; fi
done
[ "$added" -gt 0 ] || { echo "加不进去" >&2; exit 1; }

echo "==> 当前购物车"
curl -s -b "$COOKIE" "$BASE/cart"
echo ""
