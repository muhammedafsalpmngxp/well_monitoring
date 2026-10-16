import type Highcharts from 'highcharts';

export function buildFunnelOptions(
  categories: string[], values: number[], colors: string[], height: number,
  name = 'Value', showLegend = true,
): Highcharts.Options {
  const dataLabels = {
    enabled: true, inside: true, format: '{point.name}: {point.y}', style: { textOutline: 'none' },
  } satisfies Highcharts.SeriesPieDataLabelsOptionsObject & { inside: boolean };

  return {
    chart: { type: 'funnel', backgroundColor: 'transparent', height },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: showLegend },
    tooltip: { pointFormat: '<b>{point.y}</b>' },
    plotOptions: {
      funnel: {
        neckWidth: '30%', neckHeight: '25%', width: '80%', showInLegend: showLegend,
        dataLabels,
      },
    },
    series: [{
      type: 'funnel', name, showInLegend: showLegend,
      data: categories.map((category, index) => ({
        name: category, y: values[index] ?? 0, color: colors[index % colors.length],
      })),
    }],
  };
}