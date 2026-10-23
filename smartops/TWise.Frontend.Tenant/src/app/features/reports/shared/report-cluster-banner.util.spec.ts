import { describe, expect, it } from 'vitest';
import { GlobalFilterSelection } from '../../../core/utils/global-filter-selection.util';
import { clusterBannerSelectionKey, resolveClusterBanner } from './report-cluster-banner.util';
import { ReportJsonConfig } from './report-config.model';

describe('cluster banner', () => {
  it.each<{ enabled: boolean; selection: GlobalFilterSelection; visible: boolean }>([
    { enabled: false, selection: 'All', visible: false },
    { enabled: false, selection: 'Nimr', visible: false },
    { enabled: true, selection: 'All', visible: false },
    { enabled: true, selection: '', visible: false },
    { enabled: true, selection: [], visible: false },
    { enabled: true, selection: ['All', '', '  '], visible: false },
    { enabled: true, selection: 'Nimr', visible: true },
    { enabled: true, selection: ['Nimr', 'Amal'], visible: true },
  ])('requires opt-in and a cluster: $enabled / $selection', ({ enabled, selection, visible }) => {
    expect(resolveClusterBanner({ customClusterBannerEnabled: enabled }, selection, 'Report').visible).toBe(visible);
  });

  it('defaults to enabled when the setting is absent, but still needs a cluster', () => {
    expect(resolveClusterBanner({}, 'Nimr', 'Report').visible).toBe(true);
    expect(resolveClusterBanner({}, 'All', 'Report').visible).toBe(false);
    expect(resolveClusterBanner({ customClusterBannerEnabled: false }, 'Nimr', 'Report').visible).toBe(false);
  });

  it('normalizes selection keys without depending on multi-selection order', () => {
    expect(clusterBannerSelectionKey([' Nimr ', 'Amal', 'Nimr', 'All']))
      .toBe(clusterBannerSelectionKey(['Amal', 'Nimr']));
  });

  it('uses the report and selected cluster as the default title', () => {
    expect(resolveClusterBanner({}, ['Nimr', 'Amal'], ' Job Progress Report ').title)
      .toBe('JOB PROGRESS REPORT - NIMR, AMAL');
  });

  it('retains custom text across selection changes and serialization', () => {
    const settings: ReportJsonConfig = {
      customClusterBannerEnabled: true,
      clusterBannerText: 'Custom report title',
      clusterBannerSelection: clusterBannerSelectionKey('Nimr'),
    };
    const restored: ReportJsonConfig = JSON.parse(JSON.stringify(settings));
    expect(resolveClusterBanner(restored, 'Nimr', 'Report').title).toBe('Custom report title');
    expect(resolveClusterBanner(restored, 'Amal', 'Report').title).toBe('Custom report title');
    expect(resolveClusterBanner(restored, ['Nimr', 'Amal'], 'Report').title).toBe('Custom report title');
    expect(resolveClusterBanner(restored, 'All', 'Report').visible).toBe(false);
  });

  it('retains legacy custom text regardless of saved filters', () => {
    const settings: ReportJsonConfig = {
      customClusterBannerEnabled: true,
      clusterBannerText: 'Existing custom title',
      filters: [{ key: 'cluster', label: 'Cluster', value: 'Nimr' }],
    };
    expect(resolveClusterBanner(settings, 'Nimr', 'Report').title).toBe('Existing custom title');
    expect(resolveClusterBanner(settings, 'Amal', 'Report').title).toBe('Existing custom title');
    expect(resolveClusterBanner({ ...settings, filters: [] }, 'Nimr', 'Report').title).toBe('Existing custom title');
  });

  it.each(['', '   '])('uses dynamic defaults when custom text is empty: %j', clusterBannerText => {
    expect(resolveClusterBanner({ clusterBannerText }, 'Nimr', 'Report').title).toBe('REPORT - NIMR');
    expect(resolveClusterBanner({ clusterBannerText }, 'Amal', 'Report').title).toBe('REPORT - AMAL');
  });
});
