import { describe, expect, it, vi } from 'vitest';
import { getReportGridPageSize } from './report-grid-lifecycle.util';

describe('report grid pagination lifecycle', () => {
  it('reads the page size from a live grid', () => {
    const api = { isDestroyed: () => false, paginationGetPageSize: vi.fn(() => 50) };
    expect(getReportGridPageSize(api, 20)).toBe(50);
    expect(api.paginationGetPageSize).toHaveBeenCalledOnce();
  });

  it('never requests pagination from a destroyed grid', () => {
    const api = { isDestroyed: () => true, paginationGetPageSize: vi.fn(() => 50) };
    expect(getReportGridPageSize(api, 20)).toBe(20);
    expect(api.paginationGetPageSize).not.toHaveBeenCalled();
  });

  it('uses the fallback while a replacement grid is not ready', () => {
    expect(getReportGridPageSize(null, 20)).toBe(20);
    expect(getReportGridPageSize(undefined)).toBe(0);
  });
});
