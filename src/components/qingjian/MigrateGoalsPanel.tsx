"use client";

import { useState, useTransition } from "react";
import {
  migrateGoalsExecuteWithPasskey,
  migrateGoalsPlanWithPasskey,
  PasskeyError,
} from "@/lib/ui/passkey-client";
import { FingerprintIcon } from "./FingerprintIcon";

type PlanCounts = {
  scanned: number;
  skipped_migrated: number;
  would_upsert: number;
  errors: number;
};

type ExecuteResult = PlanCounts & {
  inserted: number;
  conflict_skip: number;
  verify: {
    goals: number;
    blocks_expected: number;
    missing: number;
    decrypt_ok: number;
    decrypt_failed: number;
    ok: boolean;
  };
};

export function MigrateGoalsPanel() {
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanCounts | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

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
    if (!confirmed) {
      setError("请先确认后再执行");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const body = await migrateGoalsExecuteWithPasskey();
        setResult(body);
        setPlan(null);
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
          setError("迁移入口不可用或已完成");
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
        blocks。试运行与执行均需重新验证通行密钥。试运行只显示计数，不含明文内容。
      </p>

      {error ? (
        <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="alert">
          {error}
        </p>
      ) : null}

      <div className={"qj-actions"}>
        <button
          type="button"
          className={"qj-btn"}
          disabled={pending}
          onClick={onDryRun}
        >
          <span className={"qj-btnRow"}>
            <FingerprintIcon />
            试运行（dry run）
          </span>
        </button>
      </div>

      {plan ? (
        <div className={"qj-banner"} role="status">
          <p>
            扫描 {plan.scanned} · 待创建 {plan.would_upsert} · 已迁移/跳过{" "}
            {plan.skipped_migrated} · 错误 {plan.errors}
          </p>
          <label className={"qj-setupField"}>
            <span className={"qj-setupLabel"}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={pending || plan.would_upsert === 0}
              />{" "}
              确认执行写入（可安全重复点击；块 id 幂等）
            </span>
          </label>
          <div className={"qj-actions"}>
            <button
              type="button"
              className={"qj-btn"}
              disabled={pending || !confirmed || plan.would_upsert === 0}
              onClick={onExecute}
            >
              <span className={"qj-btnRow"}>
                <FingerprintIcon />
                执行迁移
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className={"qj-banner"} role="status">
          <p>
            执行完成：扫描 {result.scanned} · 新写入 {result.inserted} ·
            冲突跳过 {result.conflict_skip} · 已迁移/跳过{" "}
            {result.skipped_migrated} · 错误 {result.errors}
          </p>
          <p>
            校验：goals={result.verify.goals} · blocks=
            {result.verify.blocks_expected} · missing={result.verify.missing} ·
            decrypt OK {result.verify.decrypt_ok}/
            {result.verify.decrypt_ok + result.verify.decrypt_failed}
            {result.verify.ok ? " · 通过" : " · 未通过"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
