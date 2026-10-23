import { GlobalFilterSelection, globalSelectionValues } from '../../../core/utils/global-filter-selection.util';
import { ReportJsonConfig } from './report-config.model';

type ClusterBannerSettings = Pick<ReportJsonConfig,
  'customClusterBannerEnabled' | 'clusterBannerText' | 'clusterBannerSelection' | 'filters'>;

function clusterNames(selection: GlobalFilterSelection | null | undefined): string[] {
  return [...new Set(globalSelectionValues(selection).map(name => name.trim()).filter(Boolean))];
}

export function clusterBannerSelectionKey(selection: GlobalFilterSelection | null | undefined): string {
  const names = clusterNames(selection);
  return names.length ? JSON.stringify(names.sort()) : '';
}

export function resolveClusterBanner(
  settings: ClusterBannerSettings | null | undefined,
  selection: GlobalFilterSelection | null | undefined,
  reportName: string,
): { selectedClusterName: string; selectionKey: string; visible: boolean; title: string } {
  const selectedClusterName = clusterNames(selection).join(', ');
  const selectionKey = clusterBannerSelectionKey(selection);
  const name = reportName.trim();
  const defaultTitle = (selectedClusterName ? `${name} - ${selectedClusterName}` : name).toUpperCase();
  const customTitle = settings?.clusterBannerText ?? '';

  return {
    selectedClusterName,
    selectionKey,
    visible: settings?.customClusterBannerEnabled !== false && !!selectionKey,
    title: customTitle.trim() ? customTitle : defaultTitle,
  };
}
