import html2canvas from 'html2canvas';

interface TableImageStyle {
  headerColor?: string | null;
  headerTextColor?: string | null;
  rowColors?: string[];
  rowTextColors?: string[];
}

export async function createTableImage(title: string, headers: string[], rows: unknown[][], style: TableImageStyle = {}): Promise<HTMLCanvasElement> {
  const panel = document.createElement('div');
  panel.setAttribute('aria-hidden', 'true');
  panel.style.cssText = `position:fixed;left:0;top:0;z-index:-2147483647;pointer-events:none;box-sizing:border-box;padding:20px;width:${Math.max(600, headers.length * 180 + 40)}px;background:#ffffff;color:#101828;font:14px Arial,sans-serif;`;
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:16px;overflow-wrap:anywhere;';
  panel.appendChild(heading);
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:collapse;';
  const header = table.createTHead().insertRow();
  headers.forEach(value => {
    const cell = document.createElement('th');
    cell.textContent = value;
    cell.style.cssText = 'padding:10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;';
    cell.style.backgroundColor = style.headerColor || '#2948A3';
    cell.style.color = style.headerTextColor || '#FFFFFF';
    header.appendChild(cell);
  });
  const palette = ['#EFF6FF', '#FFF7ED', '#F0FDF4', '#FEFCE8', '#FEF2F2', '#F5F3FF', '#F8FAFC', '#F0FDFA', '#FDF2F8', '#EEF2FF'];
  const body = table.createTBody();
  rows.forEach((values, index) => {
    const row = body.insertRow();
    headers.forEach((_, column) => {
      const cell = row.insertCell();
      cell.textContent = String(values[column] ?? '\u2014');
      cell.style.cssText = 'padding:10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;border-bottom:1px solid #e5e7eb;';
      cell.style.backgroundColor = style.rowColors?.[index] || palette[index % palette.length];
      cell.style.color = style.rowTextColors?.[index] || '#101828';
    });
  });
  panel.appendChild(table);
  document.body.appendChild(panel);
  try {
    const width = Math.ceil(panel.getBoundingClientRect().width);
    const height = Math.ceil(panel.getBoundingClientRect().height);
    const scale = Math.min(2, 16384 / width, 16384 / height, Math.sqrt(16777216 / (width * height)));
    return await html2canvas(panel, {
      scale, width, height, windowWidth: width, windowHeight: height,
      scrollX: 0, scrollY: 0, backgroundColor: '#ffffff', useCORS: true,
    });
  } finally {
    panel.remove();
  }
}