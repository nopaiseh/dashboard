"use client";

import { useState, useTransition } from "react";
import {
  migrateGoalsExecuteWithPasskey,
  migrateGoalsPlanWithPasskey,
  PasskeyError,
} from "@/lib/ui/passkey-client";
import { FingerprintIcon } from "./FingerprintIcon";

type PlanCounts = {
  to_migrate: number;
  already_existing: number;
  scanned: number;
  errors: number;
  csrf_token: string;
  plan_challenge_id: string;
};

type ExecuteResult = {
  to_migrate: number;
  already_existing: number;
  scanned: number;
  inserted: number;
  conflict_skip: number;
  errors: number;
  verify: {
    counts_match: boolean;
    goals: number;
    blocks_expected: number;
    missing: number;
    missing_ids: string[];
    decrypt_ok: number;
    decrypt_failed: number;
    decrypt_failed_ids: string[];
    ok: boolean;
  };
};

export function MigrateGoalsPanel({
  hasRecentStepUp,
}: {
  hasRecentStepUp: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanCounts | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const unlocked = hasRecentStepUp || plan !== null;

  function onDryRun() {
    setError(null);
    setResult(null);
    setConfirmed(false);
    startTransition(async () => {
      try {
        const body = await migrateGoalsPlanWithPasskey();
        setPlan(body);
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        if (err instanceof PasskeyError && err.status === 404) {
          setError("迁移入口不可用或已完成");
          return;
        }
        setError("试运行失败，请重试");
      }
    });
  }

  function onExecute() {
    if (!plan) {
      setError("请先完成试运行");
      return;
    }
    if (!confirmed) {
      setError("请勾选「确认迁移」");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const body = await migrateGoalsExecuteWithPasskey({
          csrfToken: plan.csrf_token,
          planChallengeId: plan.plan_challenge_id,
          confirm: true,
        });
        setResult(body);
        setPlan(null);
        setConfirmed(false);
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        if (err instanceof PasskeyError && err.status === 409) {
          setError("迁移正在进行中，请稍候");
          return;
        }
        if (err instanceof PasskeyError && err.status === 404) {
          setError("迁移入口不可用、未验证或已完成");
          return;
        }
        if (err instanceof PasskeyError && err.status === 400) {
          setError("确认或令牌无效，请重新试运行");
          return;
        }
        setError("执行失败，请重试");
      }
    });
  }

  return (
    <div>
      <p className={"qj-listHint"}>
        一次性工具：将 goals 迁移为加密的 dashboard progress
        blocks。打开试运行与执行均需通行密钥。页面只显示计数与失败
        id，从不显示明文、密钥或堆栈。
      </p>

      {error ? (
        <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="alert">
          {error}
        </p>
      ) : null}

      {!unlocked || !plan ? (
        <div className={"qj-actions"}>
          <button
            type="button"
            className={"qj-btn"}
            disabled={pending}
            onClick={onDryRun}
          >
            <span className={"qj-btnRow"}>
              <FingerprintIcon />
              验证通行密钥并试运行
            </span>
          </button>
        </div>
      ) : null}

      {plan ? (
        <div className={"qj-banner"} role="status">
          <p>
            待迁移 {plan.to_migrate}，已存在 {plan.already_existing}
            （扫描 {plan.scanned}
            {plan.errors > 0 ? ` · 错误 ${plan.errors}` : ""}）
          </p>
          <label className={"qj-setupField"}>
            <span className={"qj-setupLabel"}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={pending || plan.to_migrate === 0}
              />{" "}
              确认迁移
            </span>
          </label>
          <div className={"qj-actions"}>
            <button
              type="button"
              className={"qj-btn"}
              disabled={pending || !confirmed || plan.to_migrate === 0}
              onClick={onExecute}
            >
              <span className={"qj-btnRow"}>
                <FingerprintIcon />
                执行迁移
              </span>
            </button>
            <button
              type="button"
              className={`${"qj-btn"} ${"qj-btnGhost"}`}
              disabled={pending}
              onClick={onDryRun}
            >
              <span className={"qj-btnRow"}>重新试运行</span>
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className={"qj-banner"} role="status">
          <p>
            执行完成：写入 {result.inserted} · 冲突跳过 {result.conflict_skip} ·
            已存在 {result.already_existing} · 错误 {result.errors}
          </p>
          <p>
            校验：counts{" "}
            {result.verify.counts_match ? "匹配" : "不匹配"} · goals=
            {result.verify.goals} · blocks={result.verify.blocks_expected} ·
            decrypt OK {result.verify.decrypt_ok}/
            {result.verify.decrypt_ok + result.verify.decrypt_failed}
            {result.verify.ok ? " · 通过" : " · 未通过"}
          </p>
          {result.verify.missing_ids.length > 0 ? (
            <p>
              缺失 id：{result.verify.missing_ids.join(", ")}
            </p>
          ) : null}
          {result.verify.decrypt_failed_ids.length > 0 ? (
            <p>
              解密失败 id：{result.verify.decrypt_failed_ids.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
