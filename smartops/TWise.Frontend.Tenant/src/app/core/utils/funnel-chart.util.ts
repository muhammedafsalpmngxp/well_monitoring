import type Highcharts from 'highcharts';

export function buildFunnelOptions(
  categories: string[], values: number[], colors: string[], height: number,
  name = 'Value', showLegend = true,
): Highcharts.Options {
  // Outside labels with connectors so the narrow stages near the neck stay readable.
  const dataLabels = {
    enabled: true, inside: false, softConnector: true,
    format: '{point.name}: {point.y} ({point.percentage:.1f}%)', style: { textOutline: 'none' },
  } satisfies Highcharts.SeriesPieDataLabelsOptionsObject & { inside: boolean };

  // A funnel narrows from the largest stage to the smallest.
  const stages = categories
    .map((category, index) => ({ name: category, y: values[index] ?? 0, color: colors[index % colors.length] }))
    .sort((a, b) => b.y - a.y);

  return {
    chart: { type: 'funnel', backgroundColor: 'transparent', height },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: showLegend },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
    plotOptions: {
      funnel: {
        neckWidth: '30%', neckHeight: '25%', width: '60%', center: ['40%', '50%'], showInLegend: showLegend,
        dataLabels,
      },
    },
    series: [{
      type: 'funnel', name, showInLegend: showLegend,
      data: stages,
    }],
  };
}