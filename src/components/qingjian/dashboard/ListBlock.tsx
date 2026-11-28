import { EmptyBlock } from "./EmptyBlock";
import type { ListView } from "./types";

export function ListBlock({ view }: { view: ListView }) {
  if (view.emptyText || view.items.length === 0) {
    return (
      <EmptyBlock
        title={view.title}
        message={view.emptyText ?? "暂无数据"}
      />
    );
  }

  return (
    <article className={"qj-dashBlock qj-dashList"}>
      {view.title ? <h3 className={"qj-dashBlockTitle"}>{view.title}</h3> : null}
      <ul className={"qj-dashListItems"}>
        {view.items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 24)}`}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
