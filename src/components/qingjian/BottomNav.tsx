import Link from "next/link";
import { MOBILE_BOTTOM, type NavTabId } from "@/lib/ui/labels";

function isBottomOn(id: string, active: NavTabId): boolean {
  if (id === "today") return active === "today";
  if (id === "pending") return active === "pending";
  if (id === "todo") return active === "todo";
  if (id === "qa") return active === "qa-in" || active === "qa-out";
  return false;
}

export function BottomNav({ active }: { active: NavTabId }) {
  return (
    <nav className={"qj-bottomNav"} aria-label="手机主导航">
      {MOBILE_BOTTOM.map((item) => {
        const on = isBottomOn(item.id, active);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`${"qj-bottomLink"} ${on ? "qj-bottomOn" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
