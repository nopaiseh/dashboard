import Link from "next/link";
import type { DashboardSectionPublic } from "@/lib/dashboard/types";
import {
  OVERVIEW_EMPTY_HINT,
  OVERVIEW_EMPTY_TITLE,
  OVERVIEW_PAGE_TITLE,
  buildBoardCards,
} from "./dashboard/boardSummary";

export function DashboardOverview({
  sections,
  now,
}: {
  sections: DashboardSectionPublic[];
  now?: Date;
}) {
  const cards = buildBoardCards(sections, now ?? new Date());

  return (
    <div className={"qj-boardOverview"}>
      <header className={"qj-pageTitleRow"}>
        <h1>{OVERVIEW_PAGE_TITLE}</h1>
      </header>

      {cards.length === 0 ? (
        <div className={"qj-dashPageEmpty"} role="status">
          <p>
            <strong>{OVERVIEW_EMPTY_TITLE}</strong>
          </p>
          <p className={"qj-boardEmptyHint"}>{OVERVIEW_EMPTY_HINT}</p>
        </div>
      ) : (
        <ul className={"qj-boardGrid"}>
          {cards.map((card) => (
            <li key={card.category} className={"qj-boardGridItem"}>
              <Link href={card.href} className={"qj-boardCard"}>
                <h2 className={"qj-boardCardTitle"}>{card.name}</h2>
                <p className={"qj-boardCardSummary"}>{card.summary}</p>
                {card.updatedLabel && card.summary !== card.updatedLabel ? (
                  <p className={"qj-boardCardMeta"}>
                    <time dateTime={card.updatedIso}>{card.updatedLabel}</time>
                  </p>
                ) : card.updatedLabel ? (
                  <p className={"qj-boardCardMeta qj-sr-only"}>
                    <time dateTime={card.updatedIso}>{card.updatedLabel}</time>
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
