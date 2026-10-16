import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { DATE_RANGE_POPUP_MARGIN, DATE_RANGE_POPUP_WIDTH, zoomedViewport } from './date-range-popup.placement';

interface DayCell {
  iso: string;
  day: number;
  otherMonth: boolean;
  isFrom: boolean;
  isTo: boolean;
  inRange: boolean;
  disabled: boolean;
}

/**
 * Dual-calendar date-range picker popup (matches the "Select Date Range" design).
 * Works on ISO `yyyy-MM-dd` strings so it can drop in wherever `filterFrom`/`filterTo`
 * are already used. Selecting a range in the calendars or dragging the Quick Adjust
 * slider updates the draft; `applyRange` emits the chosen `{ from, to }` on Apply.
 */
@Component({
  selector: 'app-date-range-popup',
  standalone: false,
  templateUrl: './date-range-popup.component.html',
  styleUrls: ['./date-range-popup.component.scss'],
})
export class DateRangePopupComponent implements OnChanges {
  @Input() open = false;
  @Input() from = '';
  @Input() to = '';
  @Input() min?: string;
  @Input() max?: string;
  /** Viewport-relative anchor position (top/left in px) for the floating panel. */
  @Input() anchorTop = 0;
  @Input() anchorLeft = 0;
  /** Max height (px) available below the trigger; content scrolls inside when exceeded. */
  @Input() maxHeight = 0;

  /** Re-clamp into the viewport on resize/rotation (the getters below read the live size). */
  @HostListener('window:resize')
  onWindowResize(): void { /* change detection re-evaluates the card geometry */ }

  get cardWidth(): number {
    return Math.min(DATE_RANGE_POPUP_WIDTH, zoomedViewport().width - DATE_RANGE_POPUP_MARGIN * 2);
  }

  get cardLeft(): number {
    const max = zoomedViewport().width - this.cardWidth - DATE_RANGE_POPUP_MARGIN;
    return Math.max(DATE_RANGE_POPUP_MARGIN, Math.min(this.anchorLeft, max));
  }

  get cardTop(): number {
    const max = zoomedViewport().height - DATE_RANGE_POPUP_MARGIN - 200;
    return Math.max(DATE_RANGE_POPUP_MARGIN, Math.min(this.anchorTop, max));
  }

  get cardMaxHeight(): number {
    const room = zoomedViewport().height - this.cardTop - DATE_RANGE_POPUP_MARGIN;
    return this.maxHeight ? Math.min(this.maxHeight, room) : room;
  }

  /** Narrow card (phones, split screens): stack the two calendars and From/To fields. */
  get compact(): boolean {
    return this.cardWidth < 520;
  }

  @Output() applyRange = new EventEmitter<{ from: string; to: string }>();
  @Output() cancelRange = new EventEmitter<void>();

  draftFrom = '';
  draftTo = '';
  fromDisplay = '';
  toDisplay = '';

  /** Left/right calendar months navigate independently once shown. */
  leftYear = new Date().getFullYear();
  leftMonth = new Date().getMonth();
  rightYear = new Date().getFullYear();
  rightMonth = (new Date().getMonth() + 1) % 12;

  /** Quick Adjust slider state (day-of-year indices within `sliderYear`). */
  sliderYear = new Date().getFullYear();
  sliderFrom = 0;
  sliderTo = 0;

  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  readonly monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) this.initDraft();
  }

  // ── Init ────────────────────────────────────────────────
  private initDraft(): void {
    this.draftFrom = this.from || '';
    this.draftTo = this.to || '';
    this.syncDisplayFromDraft();
    const base = this.parseIso(this.draftFrom) ?? new Date();
    this.leftYear = base.getFullYear();
    this.leftMonth = base.getMonth();

    // Right calendar shows the To date's month when it differs, otherwise defaults to left + 1.
    const toDate = this.parseIso(this.draftTo);
    if (toDate && (toDate.getFullYear() !== this.leftYear || toDate.getMonth() !== this.leftMonth)) {
      this.rightYear = toDate.getFullYear();
      this.rightMonth = toDate.getMonth();
    } else {
      const next = this.localDate(this.leftYear, this.leftMonth + 1, 1);
      this.rightYear = next.getFullYear();
      this.rightMonth = next.getMonth();
    }
    this.syncSlider();
  }

  // ── Calendar rendering ──────────────────────────────────
  get leftTitle(): string { return `${this.monthNames[this.leftMonth]} ${this.leftYear}`; }
  get rightTitle(): string { return `${this.monthNames[this.rightMonth]} ${this.rightYear}`; }

  get leftCells(): DayCell[] { return this.buildMonth(this.leftYear, this.leftMonth); }
  get rightCells(): DayCell[] { return this.buildMonth(this.rightYear, this.rightMonth); }

  private buildMonth(year: number, month: number): DayCell[] {
    const first = this.localDate(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday-based leading offset
    const start = this.localDate(year, month, 1 - offset);
    const cells: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = this.localDate(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = this.iso(d);
      cells.push({
        iso,
        day: d.getDate(),
        otherMonth: d.getMonth() !== month,
        isFrom: !!this.draftFrom && iso === this.draftFrom,
        isTo: !!this.draftTo && iso === this.draftTo,
        inRange: this.isInRange(iso),
        disabled: this.isDisabled(iso),
      });
    }
    return cells;
  }

  private isInRange(iso: string): boolean {
    if (!this.draftFrom || !this.draftTo) return false;
    return iso > this.draftFrom && iso < this.draftTo;
  }

  private isDisabled(iso: string): boolean {
    if (this.min && iso < this.min) return true;
    if (this.max && iso > this.max) return true;
    return false;
  }

  trackByIso(_: number, cell: DayCell): string { return cell.iso; }

  shiftLeftMonth(delta: number): void {
    const d = this.localDate(this.leftYear, this.leftMonth + delta, 1);
    this.leftYear = d.getFullYear();
    this.leftMonth = d.getMonth();
  }

  shiftRightMonth(delta: number): void {
    const d = this.localDate(this.rightYear, this.rightMonth + delta, 1);
    this.rightYear = d.getFullYear();
    this.rightMonth = d.getMonth();
  }

  selectDay(cell: DayCell, field: 'from' | 'to'): void {
    if (cell.disabled) return;
    const iso = cell.iso;
    if (field === 'from') {
      this.draftFrom = iso;
      if (this.draftTo && this.draftTo < iso) this.draftTo = '';
    } else {
      if (this.draftFrom && iso < this.draftFrom) return;
      this.draftTo = iso;
    }
    this.syncDisplayFromDraft();
    this.syncSlider();
  }

  // ── Top From/To text inputs (mm-dd-yyyy) ────────────────
  onFromDisplayInput(value: string): void {
    this.fromDisplay = value;
    const iso = this.parseMdy(value);
    if (iso && !this.isDisabled(iso)) {
      this.draftFrom = iso;
      if (this.draftTo && this.draftTo < iso) {
        this.draftTo = '';
        this.toDisplay = '';
      }
      this.showMonthFor(iso);
      this.syncSlider();
    }
  }

  onToDisplayInput(value: string): void {
    this.toDisplay = value;
    const iso = this.parseMdy(value);
    if (iso && !this.isDisabled(iso) && (!this.draftFrom || iso >= this.draftFrom)) {
      this.draftTo = iso;
      this.showRightMonthFor(iso);
      this.syncSlider();
    }
  }

  // ── Quick Adjust slider ─────────────────────────────────
  get maxDay(): number { return this.isLeap(this.sliderYear) ? 365 : 364; }
  get fromPct(): number { return this.maxDay ? (this.sliderFrom / this.maxDay) * 100 : 0; }
  get toPct(): number { return this.maxDay ? (this.sliderTo / this.maxDay) * 100 : 0; }

  get sliderStartLabel(): string { return `Jan ${this.sliderYear}`; }
  get sliderEndLabel(): string { return `Dec ${this.sliderYear}`; }
  get fromThumbLabel(): string { return this.formatShort(this.draftFrom); }
  get toThumbLabel(): string { return this.formatShort(this.draftTo); }

  private syncSlider(): void {
    const f = this.parseIso(this.draftFrom);
    const t = this.parseIso(this.draftTo);
    this.sliderYear = f ? f.getFullYear() : new Date().getFullYear();
    this.sliderFrom = f ? this.dayOfYear(f) : 0;
    if (t) {
      this.sliderTo = t.getFullYear() === this.sliderYear ? this.dayOfYear(t) : this.maxDay;
    } else {
      this.sliderTo = this.sliderFrom;
    }
  }

  onSliderFrom(value: string | number): void {
    const v = Math.min(Number(value), this.sliderTo);
    this.sliderFrom = v;
    this.draftFrom = this.iso(this.dateFromDay(this.sliderYear, v));
    this.showMonthFor(this.draftFrom);
    this.syncDisplayFromDraft();
  }

  onSliderTo(value: string | number): void {
    const v = Math.max(Number(value), this.sliderFrom);
    this.sliderTo = v;
    this.draftTo = this.iso(this.dateFromDay(this.sliderYear, v));
    this.showRightMonthFor(this.draftTo);
    this.syncDisplayFromDraft();
  }

  // ── Actions ─────────────────────────────────────────────
  onApply(): void { this.applyRange.emit({ from: this.draftFrom, to: this.draftTo }); }
  onReset(): void {
    this.draftFrom = '';
    this.draftTo = '';
    this.syncDisplayFromDraft();
    this.syncSlider();
  }
  onClose(): void { this.cancelRange.emit(); }

  // ── Helpers ─────────────────────────────────────────────
  private showMonthFor(iso: string): void {
    const d = this.parseIso(iso);
    if (!d) return;
    this.leftYear = d.getFullYear();
    this.leftMonth = d.getMonth();
  }

  private showRightMonthFor(iso: string): void {
    const d = this.parseIso(iso);
    if (!d) return;
    this.rightYear = d.getFullYear();
    this.rightMonth = d.getMonth();
  }

  private syncDisplayFromDraft(): void {
    this.fromDisplay = this.formatMdy(this.draftFrom);
    this.toDisplay = this.formatMdy(this.draftTo);
  }

  private localDate(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setFullYear(year, month, day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private parseIso(iso: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return null;
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = this.localDate(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  private iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private formatMdy(iso: string): string {
    const d = this.parseIso(iso);
    if (!d) return '';
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  }

  private parseMdy(text: string): string | null {
    const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec((text || '').trim());
    if (!match) return null;
    const [, monthText, dayText, yearText] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    if (year < 1 || month < 1 || month > 12 || day < 1) return null;
    const daysInMonth = [31, this.isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > daysInMonth[month - 1]) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private formatShort(iso: string): string {
    const d = this.parseIso(iso);
    if (!d) return '';
    return `${String(d.getDate()).padStart(2, '0')} ${this.monthShort[d.getMonth()]} ${d.getFullYear()}`;
  }

  private dayOfYear(d: Date): number {
    const start = this.localDate(d.getFullYear(), 0, 1);
    return Math.round((d.getTime() - start.getTime()) / 86400000);
  }

  private dateFromDay(year: number, dayIdx: number): Date {
    return this.localDate(year, 0, 1 + dayIdx);
  }

  private isLeap(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }
}
