import type { Counts } from "@/lib/ui/data";
import type { NavTabId } from "@/lib/ui/labels";
import { BottomNav } from "./BottomNav";
import { TopNav } from "./TopNav";

export function AppShell({
  active,
  counts,
  siteName,
  children,
}: {
  active: NavTabId;
  counts: Counts | null;
  siteName: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"qj-app"}>
      <TopNav active={active} counts={counts} siteName={siteName} />
      <div className={"qj-wrap"}>{children}</div>
      <BottomNav active={active} />
    </div>
  );
}
