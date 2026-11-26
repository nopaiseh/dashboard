import type { ItemStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/ui/labels";

const STATUS_CLASS: Record<ItemStatus, string> = {
  open: "qj-chipOpen",
  approved: "qj-chipApproved",
  rejected: "qj-chipRejected",
  replied: "qj-chipReplied",
  done: "qj-chipDone",
  withdrawn: "qj-chipWithdrawn",
};

export function StatusChip({ status }: { status: ItemStatus }) {
  return (
    <span className={`${"qj-chip"} ${STATUS_CLASS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ProjectChip({ project }: { project: string }) {
  if (!project) return null;
  return <span className={`${"qj-chip"} ${"qj-chipProject"}`}>{project}</span>;
}

export function WarnChip({ children }: { children: React.ReactNode }) {
  return <span className={`${"qj-chip"} ${"qj-chipWarn"}`}>{children}</span>;
}

export function ReadChip({ read }: { read: boolean }) {
  return (
    <span className={`${"qj-chip"} ${"qj-chipRead"}`}>
      {read ? "已读取" : "待姐妹读取"}
    </span>
  );
}
