import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { DecisionPanel } from "@/components/qingjian/DecisionPanel";
import { EventTimeline } from "@/components/qingjian/EventTimeline";
import { SourceLink } from "@/components/qingjian/SourceLink";
import {
  ProjectChip,
  ReadChip,
  StatusChip,
  WarnChip,
} from "@/components/qingjian/StatusChip";
import { isValidUuid, loadAgents, loadItemDetail } from "@/lib/read";
import { formatDueDate, formatShortDate } from "@/lib/ui/format";
import { INVALIDATED_APPROVAL_LABEL } from "@/lib/ui/labels";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export default async function ItemDetailPage({ params }: PageProps) {
  await connection();
  const { id } = await params;
  if (!isValidUuid(id)) {
    notFound();
  }

  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const detail = await loadItemDetail(id);
    if (!detail) notFound();

    const { item, events } = detail;
    const agents = await loadAgents();
    const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
    const optionLabelByKey = new Map(
      (item.options ?? []).map((o) => [o.key, o.label]),
    );

    const activeTab =
      item.kind === "approval"
        ? "pending"
        : item.kind === "todo"
          ? "todo"
          : item.kind === "question_to_user"
            ? "qa-in"
            : item.kind === "question_from_user"
              ? "qa-out"
              : item.kind === "waiting"
                ? "waiting"
                : "today";

    return (
      <AppShell active={activeTab} counts={counts} siteName={siteName}>
        <article className={"qj-detail"}>
          <div className={"qj-kicker"}>
            <StatusChip status={item.status} />
            <ProjectChip project={item.project} />
            {item.result_read != null ? (
              <ReadChip read={item.result_read} />
            ) : null}
            {item.invalidated_approval ? (
              <WarnChip>{INVALIDATED_APPROVAL_LABEL}</WarnChip>
            ) : null}
          </div>

          <h1 className={"qj-ttl"}>{item.title}</h1>

          <div className={"qj-facts"}>
            <span>
              <span className={"qj-lbl"}>负责</span>
              {item.agent_name}
            </span>
            {item.due_at ? (
              <span>
                <span className={"qj-lbl"}>截止</span>
                {formatDueDate(item.due_at)}
              </span>
            ) : null}
            {item.source_url ? (
              <span>
                <span className={"qj-lbl"}>来源</span>
                <SourceLink url={item.source_url} />
              </span>
            ) : null}
            <span>
              <span className={"qj-lbl"}>最近活动</span>
              {formatShortDate(item.last_activity_at)}
            </span>
          </div>

          {item.body ? <div className={"qj-body"}>{item.body}</div> : null}

          <DecisionPanel item={item} />

          <EventTimeline
            events={events}
            agentNameById={agentNameById}
            optionLabelByKey={optionLabelByKey}
          />
        </article>
      </AppShell>
    );
  });
}
