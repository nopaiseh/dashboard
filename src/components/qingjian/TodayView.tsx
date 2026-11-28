import Link from "next/link";
import type { Counts, ItemWithMeta } from "@/lib/read";
import { ItemList } from "./ItemList";

export function TodayView({
  summary,
  counts,
  pending,
  heldPreview,
  sistersPreview,
}: {
  summary: string | null;
  counts: Counts;
  pending: ItemWithMeta[];
  heldPreview: string;
  sistersPreview: string;
}) {
  return (
    <>
      <section className={"qj-hero"} aria-labelledby="daily-summary">
        <h1 id="daily-summary">每日小结</h1>
        <p>
          {summary?.trim() ||
            "今天还没有小结。各栏件数见下方卡片，可先处理待批与待办。"}
        </p>
      </section>

      <div className={"qj-counts"} role="list" aria-label="各栏件数">
        <CountLink href="/pending" n={counts.approval} label="待批" />
        <CountLink href="/todo" n={counts.todo} label="待办" />
        <CountLink href="/waiting" n={counts.waiting} label="待回音" />
        <CountLink
          href="/held"
          n={counts.held}
          label="搁置"
          emphasis
        />
      </div>

      <div className={"qj-spotlight"} aria-label="搁置与姐妹入口">
        <Link
          href="/held"
          className={`${"qj-spotCard"} ${"qj-spotCardHeld"}`}
        >
          <span className={"qj-spotKicker"}>7 天无动静</span>
          <h3>搁置 {counts.held}</h3>
          <p>{heldPreview}</p>
        </Link>
        <Link
          href="/sisters"
          className={`${"qj-spotCard"} ${"qj-spotCardSisters"}`}
        >
          <span className={"qj-spotKicker"}>按姐妹查看</span>
          <h3>姐妹分栏</h3>
          <p>{sistersPreview}</p>
        </Link>
      </div>

      <div className={"qj-sectionHead"}>
        <h2>待批</h2>
        <Link href="/pending">查看全部</Link>
      </div>
      <ItemList items={pending} emptyText="当前没有待批事项" />
    </>
  );
}

function CountLink({
  href,
  n,
  label,
  emphasis = false,
}: {
  href: string;
  n: number;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${"qj-count"} ${emphasis ? "qj-countEmphasis" : ""}`}
      role="listitem"
    >
      <b>{n}</b>
      <span>{label}</span>
    </Link>
  );
}
