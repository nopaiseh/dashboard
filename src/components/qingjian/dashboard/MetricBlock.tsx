import { EmptyBlock } from "./EmptyBlock";
import { formatDelta, formatMoney, formatYtd } from "./format";
import type { MetricView } from "./types";

export function MetricBlock({ view }: { view: MetricView }) {
  if (view.emptyText) {
    return <EmptyBlock title={view.title} message={view.emptyText} />;
  }

  const unit = view.unit ?? "S$";
  const delta =
    view.deltaMom !== undefined
      ? view.deltaLabel?.trim() || formatDelta(view.deltaMom, unit)
      : null;
  const ytd =
    view.ytd !== undefined
      ? formatYtd(view.ytd, unit, view.ytdLabel)
      : null;

  return (
    <article className={"qj-dashBlock qj-dashMetric"}>
      <h3 className={"qj-dashBlockTitle"}>{view.title}</h3>
      {view.label ? (
        <p className={"qj-dashMetricLabel"}>{view.label}</p>
      ) : null}
      <p className={"qj-dashMetricValue"}>{formatMoney(view.value, unit)}</p>
      {delta ? <p className={"qj-dashMetricDelta"}>{delta}</p> : null}
      {ytd ? <p className={"qj-dashMetricYtd"}>{ytd}</p> : null}
    </article>
  );
}
