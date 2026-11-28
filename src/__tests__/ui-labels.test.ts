import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  INVALIDATED_APPROVAL_LABEL,
  KIND_LABELS,
  LOCKOUT_MESSAGE,
  NAV_TABS,
  STATUS_LABELS,
} from "@/lib/ui/labels";

describe("ui labels", () => {
  it("covers all status chips required by product notes", () => {
    expect(STATUS_LABELS.open).toBe("未处理");
    expect(STATUS_LABELS.approved).toBe("已批准");
    expect(STATUS_LABELS.rejected).toBe("已驳回");
    expect(STATUS_LABELS.replied).toBe("已回复");
    expect(STATUS_LABELS.done).toBe("已完成");
    expect(STATUS_LABELS.withdrawn).toBe("已撤回");
  });

  it("keeps nav order for Qingjian Today", () => {
    expect(NAV_TABS.map((t) => t.id)).toEqual([
      "today",
      "pending",
      "todo",
      "waiting",
      "held",
      "sisters",
      "settings",
    ]);
    expect(KIND_LABELS.approval).toBe("待批");
    expect(ACTION_LABELS.update).toBe("更新");
    expect(INVALIDATED_APPROVAL_LABEL).toContain("原批准已失效");
    expect(LOCKOUT_MESSAGE).toContain("15 分钟");
  });
});
