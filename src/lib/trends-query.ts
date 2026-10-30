import { isCanonicalTrendRange, isIsoDate } from "./chart-axis";
import { INSIGHT_NODE_ORDER, normalizeTrendRange, type InsightNode, type TrendRange } from "./trends";

export function isInsightNode(value: string | undefined): value is InsightNode {
  return INSIGHT_NODE_ORDER.includes(value as InsightNode);
}

export function resolveTrendQuery(input: {
  range?: string;
  date?: string;
  node?: string;
  startDate: string;
  endDate: string;
}) {
  const hasInvalidRange = input.range !== undefined && !isCanonicalTrendRange(input.range);
  const range: TrendRange = normalizeTrendRange(isCanonicalTrendRange(input.range) ? input.range : undefined);
  const validDate = isIsoDate(input.date) ? input.date : undefined;
  const selectedDate = !hasInvalidRange && validDate && validDate >= input.startDate && validDate <= input.endDate ? validDate : undefined;
  const selectedNode = !hasInvalidRange && isInsightNode(input.node) ? input.node : undefined;

  return {
    range,
    selectedDate,
    selectedNode,
    selectedIsExplicit: Boolean(selectedDate),
  };
}
