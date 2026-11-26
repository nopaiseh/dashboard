import Link from "next/link";
import type { ItemWithMeta } from "@/lib/ui/data";
import { formatDueDate, formatShortDate, sourceLinkLabel } from "@/lib/ui/format";
import { INVALIDATED_APPROVAL_LABEL } from "@/lib/ui/labels";
import { ProjectChip, StatusChip, WarnChip } from "./StatusChip";

export function ItemList({
  items,
  emptyText = "暂无事项",
}: {
  items: ItemWithMeta[];
  emptyText?: string;
}) {
  if (items.length === 0) {
    return (
      <div className={"qj-list"}>
        <p className={"qj-empty"}>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className={"qj-list"} role="list">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/items/${item.id}`}
          className={"qj-item"}
          role="listitem"
        >
          <div className={"qj-itemHead"}>
            <StatusChip status={item.status} />
            <ProjectChip project={item.project} />
            <span className={"qj-itemTitle"}>{item.title}</span>
          </div>
          {item.invalidated_approval ? (
            <WarnChip>{INVALIDATED_APPROVAL_LABEL}</WarnChip>
          ) : null}
          <div className={"qj-itemFoot"}>
            <span>
              <b>{item.agent_name}</b>
            </span>
            {item.due_at ? <span>截止 {formatDueDate(item.due_at)}</span> : null}
            {item.source_url ? (
              <span>来源 {sourceLinkLabel(item.source_url)}</span>
            ) : null}
            <span>{formatShortDate(item.last_activity_at)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
