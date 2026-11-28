import type { DashboardSectionPublic } from "@/lib/dashboard/types";

/** 分区是否声明使用 C2 九段布局（不含任何示例数字）。 */
export function sectionUsesC2Layout(
  section: DashboardSectionPublic,
): boolean {
  return section.blocks.some(
    (b) =>
      b.payload.role === "c2_layout" ||
      b.payload.layout === "c2",
  );
}
