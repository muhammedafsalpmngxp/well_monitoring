import type { GridApi } from 'ag-grid-community';

export function getReportGridPageSize(
  api: Pick<GridApi, 'isDestroyed' | 'paginationGetPageSize'> | null | undefined,
  fallback = 0,
): number {
  return api && !api.isDestroyed() ? api.paginationGetPageSize() : fallback;
}
