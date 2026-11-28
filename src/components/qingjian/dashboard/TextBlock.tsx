import { EmptyBlock, MissingYearStripe } from "./EmptyBlock";
import type { TextView } from "./types";

export function TextBlock({ view }: { view: TextView }) {
  if (view.emptyText || !view.text.trim()) {
    return (
      <>
        <EmptyBlock
          title={view.title}
          message={view.emptyText ?? "暂无数据"}
        />
        <MissingYearStripe years={view.missingYears} />
      </>
    );
  }

  return (
    <article className={"qj-dashBlock qj-dashText"}>
      {view.title ? <h3 className={"qj-dashBlockTitle"}>{view.title}</h3> : null}
      <p className={"qj-dashTextBody"}>{view.text}</p>
      <MissingYearStripe years={view.missingYears} />
    </article>
  );
}
