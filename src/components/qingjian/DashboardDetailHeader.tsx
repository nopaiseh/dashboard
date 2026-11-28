import Link from "next/link";
import { OVERVIEW_BACK_LABEL } from "./dashboard/boardSummary";

/** Back link shown above a single-category dashboard detail view. */
export function DashboardDetailHeader() {
  return (
    <header className={"qj-dashDetailHead"}>
      <Link href="/" className={"qj-dashBack"}>
        {OVERVIEW_BACK_LABEL}
      </Link>
    </header>
  );
}
