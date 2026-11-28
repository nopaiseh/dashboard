import type { DashboardBlockPublic } from "@/lib/dashboard/types";
import { ChartSeriesBlock } from "./ChartSeriesBlock";
import { EmptyBlock } from "./EmptyBlock";
import { ListBlock } from "./ListBlock";
import { MetricBlock } from "./MetricBlock";
import {
  parseChartSeriesPayload,
  parseListPayload,
  parseMetricPayload,
  parseProgressPayload,
  parseTextPayload,
} from "./parse";
import { ProgressBlock } from "./ProgressBlock";
import { TextBlock } from "./TextBlock";

export function BlockRenderer({ block }: { block: DashboardBlockPublic }) {
  if (block.decrypt_failed) {
    return <EmptyBlock title="无法解密" message="暂无数据" />;
  }

  switch (block.block_type) {
    case "headline":
      return null;
    case "metric": {
      const view = parseMetricPayload(block.payload);
      if (!view) return <EmptyBlock message="暂无数据" />;
      return <MetricBlock view={view} />;
    }
    case "progress": {
      const view = parseProgressPayload(block.payload);
      if (!view) return <EmptyBlock message="暂无数据" />;
      return <ProgressBlock view={view} blockId={block.id} />;
    }
    case "list": {
      const view = parseListPayload(block.payload);
      if (!view) return <EmptyBlock message="暂无数据" />;
      return <ListBlock view={view} />;
    }
    case "text": {
      const view = parseTextPayload(block.payload);
      if (!view) return <EmptyBlock message="暂无数据" />;
      return <TextBlock view={view} />;
    }
    case "chart_series": {
      const view = parseChartSeriesPayload(block.payload);
      if (!view) return <EmptyBlock message="暂无数据" />;
      return <ChartSeriesBlock view={view} />;
    }
    default:
      return <EmptyBlock message="暂无数据" />;
  }
}
