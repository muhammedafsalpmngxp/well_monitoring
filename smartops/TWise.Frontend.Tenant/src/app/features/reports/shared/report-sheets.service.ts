import { Injectable } from '@angular/core';

/** One Excel-like page in the report builder. `state` is an opaque per-sheet
 *  snapshot owned by the builder component — the service never inspects it. */
export interface ReportSheet {
  id: string;
  name: string;
  state: unknown | null;
}

/**
 * Manages the collection of Excel-like sheets in the report builder: creation,
 * deletion, renaming and active-sheet tracking. State snapshotting itself is left
 * to the builder component (it owns the shape); this service only stores the blob.
 *
 * Provided per builder instance (see ReportBuilderComponent providers) so each
 * builder session starts with a clean set of sheets.
 */
@Injectable()
export class ReportSheetsService {
  private _sheets: ReportSheet[] = [];
  private _activeId = '';
  private seq = 0;

  get sheets(): ReportSheet[] { return this._sheets; }
  get activeId(): string { return this._activeId; }
  get active(): ReportSheet | undefined { return this._sheets.find(s => s.id === this._activeId); }

  /** At least one sheet must always remain, so deletion is blocked at the last sheet. */
  get canDelete(): boolean { return this._sheets.length > 1; }

  /** Resets to a single starting sheet and returns it. */
  reset(name = 'Sheet 1'): ReportSheet {
    this.seq = 1;
    const sheet: ReportSheet = { id: this.newId(), name, state: null };
    this._sheets = [sheet];
    this._activeId = sheet.id;
    return sheet;
  }

  /** Rebuilds the sheet list from saved pages (name + pre-built state); first sheet becomes active. */
  seed(entries: { name: string; state: unknown }[]): ReportSheet[] {
    this.seq = entries.length;
    this._sheets = entries.map(e => ({ id: this.newId(), name: e.name, state: e.state }));
    this._activeId = this._sheets[0]?.id ?? '';
    return this._sheets;
  }

  /** Appends a new sheet, makes it active and returns it. */
  add(name?: string): ReportSheet {
    this.seq += 1;
    const sheet: ReportSheet = { id: this.newId(), name: name ?? `Sheet ${this.seq}`, state: null };
    this._sheets.push(sheet);
    this._activeId = sheet.id;
    return sheet;
  }

  /**
   * Removes a sheet (unless it's the last one) and returns the sheet that should
   * become active — the previous neighbour when the removed sheet was active,
   * otherwise the current active sheet.
   */
  remove(id: string): ReportSheet | undefined {
    if (!this.canDelete) return undefined;
    const idx = this._sheets.findIndex(s => s.id === id);
    if (idx === -1) return this.active;
    const wasActive = this._activeId === id;
    this._sheets.splice(idx, 1);
    if (wasActive) {
      const next = this._sheets[Math.max(0, idx - 1)];
      this._activeId = next.id;
      return next;
    }
    return this.active;
  }

  rename(id: string, name: string): void {
    const sheet = this._sheets.find(s => s.id === id);
    const trimmed = name.trim();
    if (sheet && trimmed) sheet.name = trimmed;
  }

  setActive(id: string): void {
    if (this._sheets.some(s => s.id === id)) this._activeId = id;
  }

  /** Moves a sheet one place left (-1) or right (1). Nothing happens at either end. */
  move(id: string, offset: -1 | 1): void {
    const from = this._sheets.findIndex(s => s.id === id);
    const to = from + offset;
    if (from === -1 || to < 0 || to >= this._sheets.length) return;
    const [sheet] = this._sheets.splice(from, 1);
    this._sheets.splice(to, 0, sheet);
  }

  /** Stores the given snapshot against the currently active sheet. */
  saveState(state: unknown): void {
    const sheet = this.active;
    if (sheet) sheet.state = state;
  }

  private newId(): string {
    return `sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }
}
