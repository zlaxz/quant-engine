/**
 * DynamicRenderer - Renders all active dynamic visualizations
 * This component displays charts, tables, metrics, and code blocks from the ResearchDisplayContext
 */

import { useResearchDisplay } from '@/contexts/ResearchDisplayContext';
import { GenericChart, GenericTable, MetricsDashboard, CodeDisplay } from '@/components/charts';

export function DynamicRenderer() {
  const { charts, tables, metrics, codeBlocks } = useResearchDisplay();

  // Convert Records to arrays for rendering
  const chartArray = Object.values(charts);
  const tableArray = Object.values(tables);
  const metricsArray = Object.values(metrics);
  const codeArray = Object.values(codeBlocks);

  // If nothing to display, return null
  if (chartArray.length === 0 && tableArray.length === 0 &&
      metricsArray.length === 0 && codeArray.length === 0) {
    return null;
  }

  return (
    <div className="dynamic-renderer space-y-4 p-4">
      {/* Render all active metrics dashboards */}
      {metricsArray.map(metricSet => (
        <MetricsDashboard key={metricSet.id} data={metricSet} />
      ))}

      {/* Render all active charts */}
      {chartArray.map(chart => (
        <GenericChart key={chart.id} data={chart} />
      ))}

      {/* Render all active tables */}
      {tableArray.map(table => (
        <GenericTable key={table.id} data={table} />
      ))}

      {/* Render all active code displays */}
      {codeArray.map(codeBlock => (
        <CodeDisplay key={codeBlock.id} data={codeBlock} />
      ))}
    </div>
  );
}
