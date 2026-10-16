/** Only full-width gaps are safe: one card's edge may cross another column's card. */
export function dashboardExportSafeCutYs(
  items: readonly { y: number; h: number }[],
  bodyY: number,
  canvasHeight: number,
): number[] {
  const spans = items.map(item => [bodyY + item.y, bodyY + item.y + item.h] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const cuts: number[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const firstSafePixel = Math.ceil(merged[i][1]);
    const lastSafePixel = Math.floor(merged[i + 1][0]);
    if (firstSafePixel <= lastSafePixel) {
      cuts.push(Math.floor((firstSafePixel + lastSafePixel) / 2));
    }
  }
  // Keep the header with the first card group, never on its own page.
  cuts.push(canvasHeight);
  return cuts;
}

export function splitDashboardExport(canvas: HTMLCanvasElement, pageAspectRatio: number, safeCutYs?: number[]): HTMLCanvasElement[] {
  if (canvas.width <= 0 || canvas.height <= 0 || !Number.isFinite(pageAspectRatio) || pageAspectRatio <= 0) {
    throw new Error('Invalid dashboard export dimensions');
  }
  const pageHeight = Math.max(1, Math.floor(canvas.width * pageAspectRatio));
  const sortedSafeCuts = safeCutYs
    ? [...new Set(safeCutYs.filter(y => Number.isFinite(y) && y > 0 && y <= canvas.height).map(Math.floor))]
      .filter(y => y > 0).sort((a, b) => a - b)
    : [];
  const pages: HTMLCanvasElement[] = [];
  let offset = 0;
  while (offset < canvas.height) {
    let height = Math.min(pageHeight, canvas.height - offset);
    if (offset + height < canvas.height) {
      // Prefer the last safe cut that fits on one page. Stretching past the page height makes the
      // caller shrink the whole page to fit, which narrows it and centres it with blank sides - the
      // header and cards then no longer line up with the page edges or with the other pages.
      const maxEnd = offset + pageHeight;
      let cut = -1;
      for (const y of sortedSafeCuts) {
        if (y > offset && y <= maxEnd) cut = y;
        else if (y > maxEnd) break;
      }
      if (cut > 0) {
        height = cut - offset;
      } else {
        // Keep an oversized card group whole; the caller scales it to the page/slide bounds.
        const nextCut = sortedSafeCuts.find(y => y > offset);
        if (nextCut) height = Math.min(nextCut - offset, canvas.height - offset);
        else if (safeCutYs !== undefined) height = canvas.height - offset;
      }
    }
    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = height;
    page.getContext('2d')!.drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height);
    pages.push(page);
    offset += height;
  }
  return pages;
}