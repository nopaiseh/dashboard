"use client";

import { useState, type ReactNode } from "react";
import { C2_LEDGER } from "./c2Data";

export function CpfLedger({ sampleMode = false }: { sampleMode?: boolean }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <div className={"k-sec"}>
        <h2>
          流水
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
        </h2>
        <span className={"r"}>放最下面，可折叠</span>
      </div>
      <details
        className={"card k-det"}
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <h2>
            缴存和提取流水{" "}
            <span className={"chip chipNeutral"}>最近 6 个月</span>
          </h2>
          <span className={"k-fold"}>
            {open ? "收起 ▴" : "展开 ▾"} · 展开更早记录（共 12 个月）
          </span>
        </summary>
        <div className={"k-ledgerBody"}>
          <table className={"k-tbl"}>
            <thead>
              <tr>
                <th className={"l"}>入账日期</th>
                <th className={"l"}>类型</th>
                <th className={"l"}>说明 / 用途</th>
                <th>OA</th>
                <th>SA</th>
                <th>MA</th>
                <th>合计（S$）</th>
              </tr>
            </thead>
            <tbody>
              {C2_LEDGER.map((row) => (
                <tr key={`${row.date}-${row.note}`}>
                  <td className={"l"}>{row.date}</td>
                  <td className={"l"}>
                    <span
                      className={
                        row.kind === "in" ? "k-type k-in" : "k-type k-fee"
                      }
                    >
                      {row.typeLabel}
                    </span>
                  </td>
                  <td className={"l"}>{row.note}</td>
                  <td>{cell(row.OA)}</td>
                  <td>{cell(row.SA)}</td>
                  <td>{cell(row.MA)}</td>
                  <td>
                    <b>{cell(row.total)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={"l"} colSpan={3}>
                  最近 6 个月合计
                </td>
                <td />
                <td />
                <td />
                <td>缴存 +17,760 · 保险扣款 −500 · 提取 0</td>
              </tr>
            </tfoot>
          </table>
          <div className={"k-empty k-empty-sm"}>
            <b>无提取</b>
            　近 6 个月没有买房、医疗就诊等提取。MA 支出仅为 MediShield Life 与
            CareShield Life 保费。
          </div>
        </div>
      </details>
    </>
  );
}

function cell(v: number | null): ReactNode {
  if (v == null) return "—";
  if (v < 0) {
    return (
      <span className={"neg"}>
        −{Math.abs(v).toLocaleString("en-SG")}
      </span>
    );
  }
  return v.toLocaleString("en-SG");
}
