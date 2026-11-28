import type { ItemEventPublic } from "@/lib/types";
import { formatShortDate } from "@/lib/ui/format";
import { ACTION_LABELS } from "@/lib/ui/labels";

export function EventTimeline({
  events,
  agentNameById,
  optionLabelByKey,
}: {
  events: ItemEventPublic[];
  agentNameById: Map<string, string>;
  optionLabelByKey: Map<string, string>;
}) {
  if (events.length === 0) {
    return (
      <div className={"qj-history"}>
        <h3>事件流水</h3>
        <p className={"qj-empty"}>暂无事件</p>
      </div>
    );
  }

  return (
    <div className={"qj-history"}>
      <h3>事件流水</h3>
      <ol className={"qj-timeline"}>
        {events.map((ev) => {
          const who =
            ev.actor_type === "user"
              ? "本人"
              : ev.agent_id
                ? (agentNameById.get(ev.agent_id) ?? "专员")
                : "专员";
          const option =
            ev.option_key != null
              ? optionLabelByKey.get(ev.option_key) ?? ev.option_key
              : null;
          const extra =
            ev.action === "reply" && ev.reply_text
              ? ev.reply_text
              : option
                ? `选项「${option}」`
                : "";
          return (
            <li key={ev.id}>
              <span className={"qj-when"}>
                {formatShortDate(ev.created_at)}
              </span>
              <span className={"qj-ev"}>
                {ACTION_LABELS[ev.action] ?? ev.action}
              </span>
              {who}
              {extra ? ` · ${extra}` : ""}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
