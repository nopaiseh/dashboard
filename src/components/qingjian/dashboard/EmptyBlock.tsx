import { BLOCK_EMPTY_DEFAULT } from "./labels";

export function EmptyBlock({
  title,
  message,
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className={"qj-dashBlock qj-dashEmpty"} role="status">
      {title ? <h3 className={"qj-dashBlockTitle"}>{title}</h3> : null}
      <p className={"qj-dashEmptyMsg"}>{message?.trim() || BLOCK_EMPTY_DEFAULT}</p>
    </div>
  );
}

export function MissingYearStripe({ years }: { years: string[] }) {
  if (years.length === 0) return null;
  return (
    <ul className={"qj-dashMissingYears"} aria-label="缺结算单的年份">
      {years.map((y) => (
        <li key={y} className={"qj-dashMissingYear"}>
          <span className={"qj-dashMissingStripe"} aria-hidden="true" />
          <span>
            {y} · 该年暂无结算单
          </span>
        </li>
      ))}
    </ul>
  );
}
