import { describe, expect, it } from 'vitest';
import { ReportSheetsService } from './report-sheets.service';

describe('ReportSheetsService.move', () => {
  it('moves a sheet one place, keeps it active, and does nothing at either end', () => {
    const sheets = new ReportSheetsService();
    const [a, b, c] = [...sheets.seed([{ name: 'A', state: null }, { name: 'B', state: null }, { name: 'C', state: null }])];
    sheets.setActive(b.id);

    sheets.move(b.id, -1);
    expect(sheets.sheets.map(sheet => sheet.name)).toEqual(['B', 'A', 'C']);
    expect(sheets.activeId).toBe(b.id);

    sheets.move(b.id, -1);
    sheets.move(c.id, 1);
    expect(sheets.sheets.map(sheet => sheet.name)).toEqual(['B', 'A', 'C']);

    sheets.move(a.id, 1);
    expect(sheets.sheets.map(sheet => sheet.name)).toEqual(['B', 'C', 'A']);
  });
});
