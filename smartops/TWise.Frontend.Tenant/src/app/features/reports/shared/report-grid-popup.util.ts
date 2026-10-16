import type { PostProcessPopupParams } from 'ag-grid-community';

/** Page-size choices open above pagination so they cannot cover the report's bottom bars. */
export function positionReportPaginationPopup(
  { ePopup, eventSource }: Pick<PostProcessPopupParams, 'ePopup' | 'eventSource'>,
): void {
  if (!eventSource?.closest('.ag-paging-page-size')) return;

  const sourceRect = eventSource.getBoundingClientRect();
  const popupRect = ePopup.getBoundingClientRect();
  const scale = ePopup.offsetHeight > 0 ? popupRect.height / ePopup.offsetHeight : 1;
  const targetTop = Math.max(0, sourceRect.top - popupRect.height - 4);
  // Popup parents may be inside CSS zoom; translate viewport pixels back to their local coordinates.
  ePopup.style.top = `${parseFloat(ePopup.style.top) + (targetTop - popupRect.top) / scale}px`;
}
