/** A captured sheet: its name and the picture of it. */
export interface SheetShot { name: string; canvas: HTMLCanvasElement; }

/** fit: sheets on standard pages (A4 landscape, 16:9 slides, 1920-pixel images); actual: each page the sheet's size. */
export type ExportSize = 'fit' | 'actual';

/** A4 landscape in points. */
const A4 = { width: 842, height: 595 };

/** The picture scaled to 1920 pixels wide. */
export function fitPng(source: HTMLCanvasElement, width = 1920): HTMLCanvasElement {
  const scaled = document.createElement('canvas');
  scaled.width = width;
  scaled.height = Math.round((source.height * width) / source.width);
  scaled.getContext('2d')?.drawImage(source, 0, 0, scaled.width, scaled.height);
  return scaled;
}

/** A file name without the characters Windows and macOS refuse. */
export function fileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Canvas';
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One PDF page per sheet. Actual size: each page the size of its picture, so a fixed page size prints as it shows.
 * Fit to width: A4 landscape pages with the sheet as wide as the page; a sheet taller than that runs on to more pages.
 */
export async function sheetsToPdf(title: string, shots: SheetShot[], fit: ExportSize = 'actual'): Promise<void> {
  const { default: JsPdf } = await import('jspdf');
  // The pictures are drawn at twice the screen size; the pages use the screen size in points.
  const size = (shot: SheetShot): [number, number] => fit === 'fit'
    ? [A4.width, (shot.canvas.height * A4.width) / shot.canvas.width]
    : [shot.canvas.width / 2, shot.canvas.height / 2];
  const pageOf = (shot: SheetShot): [number, number] => fit === 'fit' ? [A4.width, A4.height] : size(shot);
  const [firstW, firstH] = pageOf(shots[0]);
  const pdf = new JsPdf({ orientation: firstW >= firstH ? 'landscape' : 'portrait', unit: 'pt', format: [firstW, firstH] });
  let first = true;
  for (const shot of shots) {
    const [w, h] = size(shot);
    const [pageW, pageH] = pageOf(shot);
    // JPEG keeps a page to a few hundred KB; a PNG page of a full sheet takes several MB in a PDF.
    const image = shot.canvas.toDataURL('image/jpeg', 0.92);
    // A picture taller than the page is drawn again on the next page, moved up by a page each time.
    for (let top = 0; top < h - 1; top += pageH) {
      if (!first) pdf.addPage([pageW, pageH], pageW >= pageH ? 'landscape' : 'portrait');
      first = false;
      pdf.addImage(image, 'JPEG', 0, h < pageH ? (pageH - h) / 2 : -top, w, h);
    }
  }
  pdf.save(`${fileName(title)}.pdf`);
}

/**
 * One slide per sheet. With a fixed page size the slides take its shape; otherwise they are 16:9 and each sheet
 * is fitted in the middle.
 */
export async function sheetsToPptx(title: string, shots: SheetShot[], page: { width: number; height: number } | null): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  const slideW = 13.33;
  const slideH = page ? (13.33 * page.height) / page.width : 7.5;
  pres.defineLayout({ name: 'CANVAS', width: slideW, height: slideH });
  pres.layout = 'CANVAS';
  pres.title = title;
  for (const shot of shots) {
    const slide = pres.addSlide();
    const ratio = shot.canvas.width / shot.canvas.height;
    const w = Math.min(slideW, slideH * ratio);
    const h = w / ratio;
    slide.addImage({ data: shot.canvas.toDataURL('image/png'), x: (slideW - w) / 2, y: (slideH - h) / 2, w, h, altText: shot.name });
  }
  await pres.writeFile({ fileName: `${fileName(title)}.pptx` });
}

/** An object's rows as an Excel sheet: a bold header row in the names the object shows, then the values. */
export async function rowsToExcel(title: string, columns: string[], rows: Record<string, unknown>[], labels: Record<string, string>): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  // Excel allows 31 characters in a sheet name and no []:*?/\ in it.
  const sheet = workbook.addWorksheet(fileName(title).replace(/[[\]]/g, '').slice(0, 31) || 'Data');
  sheet.columns = columns.map(column => ({
    header: labels[column] ?? column.slice(column.indexOf('.') + 1), key: column, width: Math.min(40, Math.max(12, column.length + 4)),
  }));
  rows.forEach(row => sheet.addRow(Object.fromEntries(columns.map(column => [column, excelValue(row[column])]))));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileName(title)}.xlsx`);
}

/** Numbers stay numbers and ISO dates become dates, so Excel can sort and add them up. */
export function excelValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(value)) {
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  return value;
}
