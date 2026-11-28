import { EmptyBlock } from "./EmptyBlock";
import { formatMoney, progressCaption, progressFill } from "./format";
import type { ProgressView } from "./types";

export function ProgressBlock({
  view,
  blockId,
}: {
  view: ProgressView;
  blockId: string;
}) {
  if (view.emptyText) {
    return <EmptyBlock title={view.title} message={view.emptyText} />;
  }

  const unit = view.unit ?? view.metric ?? "S$";
  const caption = progressCaption({
    reachedTier: view.reachedTier,
    nextTier: view.nextTier,
    nextTierYear: view.nextTierYear,
    overshoot: view.overshoot,
    unit,
    target: view.target,
  });

  const layout = computeTrack(view);
  const patternId = `qj-overstripe-${cssId(blockId)}`;

  return (
    <article className={"qj-dashBlock qj-dashProgress"}>
      <h3 className={"qj-dashBlockTitle"}>{view.title}</h3>
      {view.value != null ? (
        <p className={"qj-dashProgressValue"}>
          {formatMoney(view.value, unit)}
        </p>
      ) : null}

      <div className={"qj-dashProgressTrackWrap"}>
        <svg
          className={"qj-dashProgressSvg"}
          viewBox={`0 0 ${layout.trackWidth} 14`}
          role="img"
          aria-label={`${view.title} 进度 ${layout.ariaPct}%`}
        >
          <defs>
            <pattern
              id={patternId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" className={"qj-dashOverPatBg"} />
              <rect width="2" height="6" className={"qj-dashOverPatFg"} />
            </pattern>
          </defs>
          <rect
            x="0"
            y="3"
            width={layout.trackWidth}
            height="8"
            rx="4"
            className={"qj-dashProgressTrack"}
          />
          <rect
            x="0"
            y="3"
            width={layout.solidWidth}
            height="8"
            rx="4"
            className={"qj-dashProgressFill"}
          />
          {layout.stripeWidth > 0 ? (
            <rect
              x={layout.solidWidth}
              y="3"
              width={layout.stripeWidth}
              height="8"
              className={"qj-dashProgressOver"}
              fill={`url(#${patternId})`}
            />
          ) : null}
          {layout.marks.map((mark) => (
            <line
              key={mark.key}
              x1={mark.x}
              x2={mark.x}
              y1="1"
              y2="13"
              className={"qj-dashTierMark"}
            />
          ))}
        </svg>
        {view.tiers.length > 0 ? (
          <ul className={"qj-dashTierLabels"} aria-label="进度档位">
            {view.tiers.map((tier) => (
              <li key={tier.key}>
                <span className={"qj-dashTierKey"}>{tier.label}</span>
                <span className={"qj-dashTierAmt"}>
                  {formatMoney(tier.amount, unit)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {caption ? <p className={"qj-dashProgressCaption"}>{caption}</p> : null}
      {view.status && view.status !== "empty" ? (
        <p className={"qj-dashProgressStatus"}>{view.status}</p>
      ) : null}
    </article>
  );
}

function computeTrack(view: ProgressView): {
  trackWidth: number;
  solidWidth: number;
  stripeWidth: number;
  ariaPct: number;
  marks: Array<{ key: string; x: number }>;
} {
  const BASE = 100;

  // Prefer absolute value + tiers when both exist (CPF BRS/FRS/ERS).
  if (view.tiers.length > 0 && view.value != null && view.value >= 0) {
    const reached = view.reachedTier
      ? view.tiers.find(
          (t) =>
            t.key === view.reachedTier || t.label === view.reachedTier,
        )
      : undefined;
    const next = view.nextTier
      ? view.tiers.find(
          (t) => t.key === view.nextTier || t.label === view.nextTier,
        )
      : undefined;

    const maxAmount = Math.max(
      ...view.tiers.map((t) => t.amount),
      view.value,
      next?.amount ?? 0,
    );
    const scale = maxAmount > 0 ? BASE / maxAmount : 0;
    const valueX = view.value * scale;
    const reachedX = reached ? reached.amount * scale : 0;
    const overshoot =
      view.overshoot != null && view.overshoot > 0
        ? view.overshoot * scale
        : Math.max(0, valueX - reachedX);

    // Solid up to reached tier (or value if below all tiers); stripe for overshoot toward next.
    const solidWidth =
      reached && view.value >= reached.amount
        ? Math.min(BASE, reachedX)
        : Math.min(BASE, valueX);
    const stripeWidth =
      reached && view.value > reached.amount
        ? Math.min(40, Math.max(overshoot, valueX - solidWidth))
        : 0;

    return {
      trackWidth: BASE + (stripeWidth > 0 ? Math.min(40, stripeWidth) : 0),
      solidWidth,
      stripeWidth,
      ariaPct: Math.round((view.value / maxAmount) * 100),
      marks: view.tiers.map((t) => ({
        key: t.key,
        x: Math.min(BASE, t.amount * scale),
      })),
    };
  }

  const fill = progressFill(view.progress);
  return {
    trackWidth: BASE + (fill.overshootPct > 0 ? fill.overshootPct : 0),
    solidWidth: Math.min(BASE, fill.withinPct),
    stripeWidth: fill.overshootPct,
    ariaPct: Math.round(fill.ratio * 100),
    marks: [],
  };
}

function cssId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 36) || "x";
}
