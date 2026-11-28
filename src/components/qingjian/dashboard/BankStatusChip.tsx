import {
  bankStatusChipClass,
  bankStatusChipKind,
  isBankProgressOver,
} from "./bankFormat";

export function BankStatusChip({
  status,
  progress,
  statusText,
}: {
  status?: string;
  progress?: number | null;
  statusText: string;
}) {
  const text = statusText.trim();
  if (!text) return null;
  const kind = bankStatusChipKind(status, progress);
  // 超标时强制红徽章（即使 status 文案来自 behind）
  const cls =
    isBankProgressOver(progress) && status !== "no_target"
      ? bankStatusChipClass("red")
      : bankStatusChipClass(kind);
  return <span className={cls}>{text}</span>;
}
