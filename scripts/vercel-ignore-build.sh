#!/usr/bin/env bash
# Vercel Ignored Build Step（vercel.json → ignoreCommand）
#
# 约定（与 Vercel 一致）：
#   exit 0 → 跳过本次构建（省费用）
#   exit 1 → 继续构建
#
# 规则（项目负责人已批准）：
#   1. VERCEL_ENV=production → 永远构建
#   2. 预览默认跳过；仅当提交 subject（第一行）含 [preview]，或相对 main 有前端界面改动时才构建
#   3. 分支名以 dependabot/ 或 renovate/ 开头 → 跳过（除非 subject 含 [preview]）
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

# Vercel 会把完整 commit message（含正文）塞进该变量；只看第一行 subject，
# 避免正文里「说明用法含 [preview]」这类文档文字误触发强制构建。
commit_msg="${VERCEL_GIT_COMMIT_MESSAGE:-}"
commit_subject="${commit_msg%%$'\n'*}"
branch_ref="${VERCEL_GIT_COMMIT_REF:-}"

# --- 2a / 3 例外：提交 subject 含 [preview] → 构建（含 bot 分支）---
if [[ "$commit_subject" == *"[preview]"* ]]; then
  log "提交 subject 含 [preview] → 构建 (exit 1)"
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

# 解析用于对比的 main ref（优先 origin/main，其次本地 main）
resolve_main_ref() {
  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    echo "origin/main"
    return 0
  fi
  if git rev-parse --verify --quiet main >/dev/null 2>&1; then
    echo "main"
    return 0
  fi
  return 1
}

# Vercel 浅克隆常无 remotes；用环境变量补上 origin 再 fetch main
ensure_origin_main() {
  if resolve_main_ref >/dev/null; then
    return 0
  fi

  local owner="${VERCEL_GIT_REPO_OWNER:-}"
  local slug="${VERCEL_GIT_REPO_SLUG:-}"
  if [[ -n "$owner" && -n "$slug" ]]; then
    if ! git remote get-url origin >/dev/null 2>&1; then
      log "无 origin remote，添加 https://github.com/${owner}/${slug}.git"
      git remote add origin "https://github.com/${owner}/${slug}.git" >&2 || true
    fi
  fi

  if git remote get-url origin >/dev/null 2>&1; then
    log "尝试 git fetch origin main…"
    if git fetch --depth=50 origin main >&2; then
      return 0
    fi
    log "fetch origin main 失败（私有仓无凭据等）"
  else
    log "无可用 git remote，无法 fetch main"
  fi
  return 1
}

# 尝试拿到与 main 的改动列表；失败则退回 PREVIOUS_SHA；再失败则保守构建
# 诊断日志走 stderr；stdout 仅输出文件路径（一行一个）
collect_changed_files() {
  local base="" range="" files="" main_ref=""

  ensure_origin_main || true
  main_ref="$(resolve_main_ref || true)"

  if [[ -n "$main_ref" ]]; then
    if base="$(git merge-base HEAD "$main_ref" 2>/dev/null)"; then
      log "merge-base(HEAD, $main_ref)=$base"
      range="${base}...HEAD"
      if files="$(git diff --name-only "$range" 2>/dev/null)"; then
        printf '%s\n' "$files"
        return 0
      fi
      log "git diff $range 失败"
    else
      log "无法计算与 $main_ref 的 merge-base（浅克隆过浅？）"
      if git remote get-url origin >/dev/null 2>&1 && git fetch --deepen=100 origin main >&2; then
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
        log "git fetch --deepen 不可用或失败"
      fi
    fi
  else
    log "仍无 main / origin/main"
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
