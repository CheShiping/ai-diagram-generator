#!/bin/bash
set -euo pipefail

echo "=== sql2er 验证 ==="
npm run typecheck
npm test
npm run build
echo "=== 验证完成 ==="
