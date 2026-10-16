import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

interface TablePdfStyle {
  headerColor?: string | null;
  headerTextColor?: string | null;
  rowColors?: string[];
  rowTextColors?: string[];
}

export function createTablePdf(title: string, headers: string[], rows: unknown[][], style: TablePdfStyle = {}): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const palette = ['#EFF6FF', '#FFF7ED', '#F0FDF4', '#FEFCE8', '#FEF2F2', '#F5F3FF', '#F8FAFC', '#F0FDFA', '#FDF2F8', '#EEF2FF'];
  pdf.setFontSize(14);
  const titleLines = pdf.splitTextToSize(title, pdf.internal.pageSize.getWidth() - 20);
  pdf.text(titleLines, 10, 15);
  autoTable(pdf, {
    head: [headers],
    body: rows.map(row => row.map(value => String(value ?? '\u2014'))),
    startY: 20 + (titleLines.length - 1) * 6,
    margin: 10,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', minCellWidth: 28 },
    headStyles: { fillColor: style.headerColor || '#2948A3', textColor: style.headerTextColor || '#FFFFFF' },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: 0,
    didParseCell: data => {
      if (data.section !== 'body') return;
      const index = data.row.index;
      data.cell.styles.fillColor = style.rowColors?.[index] || palette[index % palette.length];
      data.cell.styles.textColor = style.rowTextColors?.[index] || '#101828';
    },
  });
  return pdf;
}