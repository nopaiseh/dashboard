#!/usr/bin/env bash
# Vercel Ignored Build Step（vercel.json → ignoreCommand）
#
# 约定（与 Vercel 一致）：
#   exit 0 → 跳过本次构建（省费用）
#   exit 1 → 继续构建
#
# 规则（项目负责人已批准）：
#   1. VERCEL_ENV=production → 永远构建
#   2. 预览默认跳过；仅当提交说明含 [preview]，或相对 main 有前端界面改动时才构建
#   3. 分支名以 dependabot/ 或 renovate/ 开头 → 跳过（除非含 [preview]）
#   4. 判断不了（浅克隆无 merge-base、fetch 失败等）→ 保守构建，并打印原因
#
# 前端界面路径（本仓库）：
#   - src/app/**/*.tsx|jsx（排除 src/app/api/**）
#   - src/components/**/*.tsx|jsx
#   - **/*.css
#   - public/**
#   - tailwind / postcss 样式配置（如有）
# 不算前端：src/app/api/**、src/lib/**、supabase/、scripts/、docs/、*.md、测试、CI、lockfile 等

set -euo pipefail

log() {
  echo "[ignore-build] $*" >&2
}

log "VERCEL_ENV=${VERCEL_ENV:-<unset>}"
log "VERCEL_GIT_COMMIT_REF=${VERCEL_GIT_COMMIT_REF:-<unset>}"
log "VERCEL_GIT_COMMIT_MESSAGE=${VERCEL_GIT_COMMIT_MESSAGE:-<unset>}"
log "VERCEL_GIT_PREVIOUS_SHA=${VERCEL_GIT_PREVIOUS_SHA:-<unset>}"

# --- 1. 生产永远构建 ---
if [[ "${VERCEL_ENV:-}" == "production" ]]; then
  log "生产环境 → 构建 (exit 1)"
  exit 1
fi

commit_msg="${VERCEL_GIT_COMMIT_MESSAGE:-}"
branch_ref="${VERCEL_GIT_COMMIT_REF:-}"

# --- 2a / 3 例外：提交说明含 [preview] → 构建（含 bot 分支）---
if [[ "$commit_msg" == *"[preview]"* ]]; then
  log "提交说明含 [preview] → 构建 (exit 1)"
  exit 1
fi

# --- 3. dependabot / renovate 预览一律跳过 ---
if [[ "$branch_ref" == dependabot/* || "$branch_ref" == renovate/* ]]; then
  log "bot 分支 ($branch_ref) 且无 [preview] → 跳过 (exit 0)"
  exit 0
fi

# --- 前端路径判定 ---
is_frontend_path() {
  local f="$1"

  case "$f" in
    public/*)
      return 0
      ;;
    *.css)
      return 0
      ;;
    tailwind.config.*|postcss.config.*|*.postcss.js|*.postcss.cjs|*.postcss.mjs)
      return 0
      ;;
  esac

  # 组件
  if [[ "$f" == src/components/* ]]; then
    case "$f" in
      *.tsx|*.jsx) return 0 ;;
    esac
  fi

  # App Router 页面 / 布局（排除 API）
  if [[ "$f" == src/app/* && "$f" != src/app/api/* ]]; then
    case "$f" in
      *.tsx|*.jsx) return 0 ;;
    esac
  fi

  return 1
}

list_has_frontend() {
  local path
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    if is_frontend_path "$path"; then
      log "命中前端文件: $path"
      return 0
    fi
  done
  return 1
}

# 尝试拿到与 main 的改动列表；失败则退回 PREVIOUS_SHA；再失败则保守构建
# 诊断日志走 stderr；stdout 仅输出文件路径（一行一个）
collect_changed_files() {
  local base="" range="" files=""

  # 确保能解析 origin/main（Vercel 浅克隆常缺此 ref）
  if ! git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    log "本地无 origin/main，尝试 git fetch…"
    if ! git fetch --depth=50 origin main >&2; then
      log "fetch origin main 失败（私有仓无凭据等）"
    fi
  fi

  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    if base="$(git merge-base HEAD origin/main 2>/dev/null)"; then
      log "merge-base(HEAD, origin/main)=$base"
      range="${base}...HEAD"
      if files="$(git diff --name-only "$range" 2>/dev/null)"; then
        printf '%s\n' "$files"
        return 0
      fi
      log "git diff $range 失败"
    else
      log "无法计算与 origin/main 的 merge-base（浅克隆过浅？）"
      # 加深后再试一次
      if git fetch --deepen=100 origin main >&2; then
        if base="$(git merge-base HEAD origin/main 2>/dev/null)"; then
          log "deepen 后 merge-base=$base"
          range="${base}...HEAD"
          if files="$(git diff --name-only "$range" 2>/dev/null)"; then
            printf '%s\n' "$files"
            return 0
          fi
        else
          log "deepen 后仍无 merge-base"
        fi
      else
        log "git fetch --deepen 失败"
      fi
    fi
  else
    log "仍无 origin/main"
  fi

  # 退回：相对上一部署 SHA（同分支连续推送）
  local prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
  if [[ -n "$prev" && "$prev" != "null" ]]; then
    log "退回使用 VERCEL_GIT_PREVIOUS_SHA=$prev"
    if files="$(git diff --name-only "${prev}" HEAD 2>/dev/null)"; then
      printf '%s\n' "$files"
      return 0
    fi
    log "git diff PREVIOUS_SHA..HEAD 失败"
  else
    log "无可用的 VERCEL_GIT_PREVIOUS_SHA"
  fi

  return 1
}

log "预览部署：检查相对 main 是否含前端界面改动…"

changed_files=""
if ! changed_files="$(collect_changed_files)"; then
  log "无法判断改动范围 → 保守构建 (exit 1)"
  exit 1
fi

if [[ -z "${changed_files//[$'\t\r\n']/}" ]]; then
  log "相对比较范围无文件改动 → 跳过 (exit 0)"
  exit 0
fi

log "改动文件："
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  log "  $line"
done <<< "$changed_files"

if printf '%s\n' "$changed_files" | list_has_frontend; then
  log "含前端界面改动 → 构建 (exit 1)"
  exit 1
fi

log "无前端界面改动（纯后端/文档/脚本等）→ 跳过 (exit 0)"
exit 0
