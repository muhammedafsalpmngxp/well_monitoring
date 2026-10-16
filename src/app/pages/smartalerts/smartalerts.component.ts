import { Component, AfterViewInit, OnDestroy, ViewEncapsulation, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import {
  EnrichedAlert, AlertStatus, Severity, USER_OPTIONS, RESOLUTION_CODES,
  enrichedAlertsForViewer, openAlertsForViewer, aiAlertSummary, alertPerformance, AlertPerf,
  suggestedResolution, ackAlert, closeAlertWithReason, snoozeAlert, reassignAlert, addComment, reopenAlert
} from '../../features/alert-rules/alert-rules';

type StatusFilter = 'open' | 'active' | 'acknowledged' | 'snoozed' | 'closed' | 'all';
type SortKey = 'priority' | 'sla' | 'severity' | 'newest';

/**
 * Smart Alerts — user (recipient) experience.
 *
 * The platform admin stays on the legacy view-only renderer. The assigned user
 * gets a rich, actionable board: AI summary, personal SLA/performance strip,
 * triage (priority sort, severity/status filters, group-by-well), a full action
 * workflow (acknowledge, close with resolution code, snooze, reassign), inline
 * context (why it fired, current value, runbook, escalation, history) and
 * collaboration (comments). All state persists locally — no backend.
 */
@Component({
  selector: 'app-smartalerts',
  templateUrl: './smartalerts.component.html',
  styleUrls: ['./smartalerts.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class SmartAlertsComponent implements AfterViewInit, OnDestroy {

  admin = false;
  me = 'You';

  // Live clock (drives SLA countdowns).
  private now = Date.now();
  private timer: any = null;

  // Source + view models.
  private all: EnrichedAlert[] = [];
  flat: EnrichedAlert[] = [];
  groups: { well: string; alerts: EnrichedAlert[] }[] = [];
  aiSummary = '';
  perf: AlertPerf = { closed: 0, onTime: 0, breached: 0, onTimePct: 100, avgResponseMins: 0 };

  // Counts for the toolbar.
  counts = { open: 0, active: 0, acknowledged: 0, snoozed: 0, closed: 0, all: 0, atRisk: 0, breached: 0, critical: 0 };

  // Controls.
  search = '';
  sevFilter: 'ALL' | Severity = 'ALL';
  statusFilter: StatusFilter = 'open';
  sort: SortKey = 'priority';
  groupByWell = false;
  sevOptions: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  resolutionCodes = RESOLUTION_CODES;
  userOptions = USER_OPTIONS;

  // Per-card UI.
  expanded: Record<string, boolean> = {};
  commentDraft: Record<string, string> = {};
  selected = new Set<string>();

  // Modals.
  closeModal: { open: boolean; ids: string[]; resolution: string; note: string; single?: EnrichedAlert } = { open: false, ids: [], resolution: '', note: '' };
  reassignModal: { open: boolean; id: string; assignee: string } = { open: false, id: '', assignee: '' };

  constructor(private auth: AuthService, private zone: NgZone, private router: Router) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    const role = this.auth.currentUser?.role || '';
    this.admin = !this.auth.currentUser || /admin/i.test(role);
    this.me = this.auth.currentUser?.name || this.auth.currentUser?.email || 'You';

    if (this.admin) {
      // Admin keeps the legacy view-only renderer.
      (window as any).saCloseAlert = () => { /* admin is view-only */ };
      this.mergeAdminLegacy();
      const fn = (window as any)['renderAlerts'];
      if (typeof fn === 'function') { try { fn(); } catch (e) { console.error('[smartalerts] renderer threw', e); } }
      return;
    }

    // User view — refresh once, then tick the SLA countdown every 30s.
    this.refresh();
    this.timer = setInterval(() => this.zone.run(() => { this.now = Date.now(); this.recompute(); }), 30000);
  }

  ngOnDestroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { delete (window as any).saCloseAlert; } catch { /* noop */ }
  }

  // ─── Data ────────────────────────────────────────────────────────────────
  private refresh(): void { this.now = Date.now(); this.recompute(); }

  private recompute(): void {
    const role = this.auth.currentUser?.role;
    this.all = enrichedAlertsForViewer(role, this.now);
    this.aiSummary = aiAlertSummary(this.all);
    this.perf = alertPerformance(role, this.now);

    const open = (a: EnrichedAlert) => a.effectiveStatus === 'active' || a.effectiveStatus === 'acknowledged';
    this.counts = {
      open: this.all.filter(open).length,
      active: this.all.filter(a => a.effectiveStatus === 'active').length,
      acknowledged: this.all.filter(a => a.effectiveStatus === 'acknowledged').length,
      snoozed: this.all.filter(a => a.effectiveStatus === 'snoozed').length,
      closed: this.all.filter(a => a.effectiveStatus === 'closed').length,
      all: this.all.length,
      atRisk: this.all.filter(a => a.atRisk).length,
      breached: this.all.filter(a => a.breached).length,
      critical: this.all.filter(a => open(a) && a.sev === 'CRITICAL').length
    };

    // Filter → sort → group.
    let list = this.all.slice();
    const sf = this.statusFilter;
    list = list.filter(a => {
      if (sf === 'open') return a.effectiveStatus === 'active' || a.effectiveStatus === 'acknowledged';
      if (sf === 'all') return true;
      return a.effectiveStatus === sf;
    });
    if (this.sevFilter !== 'ALL') list = list.filter(a => a.sev === this.sevFilter);
    const q = this.search.trim().toLowerCase();
    if (q) list = list.filter(a => (a.title + ' ' + a.desc + ' ' + a.well + ' ' + a.ruleName).toLowerCase().includes(q));

    const sevRank: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
    list.sort((a, b) => {
      if (this.sort === 'priority') return b.priority - a.priority;
      if (this.sort === 'sla') return (a.hasSla ? a.msLeft : Infinity) - (b.hasSla ? b.msLeft : Infinity);
      if (this.sort === 'severity') return sevRank[b.sev] - sevRank[a.sev];
      return b.firedAt - a.firedAt; // newest
    });
    this.flat = list;

    const map: Record<string, EnrichedAlert[]> = {};
    const order: string[] = [];
    list.forEach(a => { if (!map[a.well]) { map[a.well] = []; order.push(a.well); } map[a.well].push(a); });
    this.groups = order.map(w => ({ well: w, alerts: map[w] }));

    // Prune selections that are no longer visible.
    const visible = new Set(list.map(a => a.id));
    this.selected.forEach(id => { if (!visible.has(id)) this.selected.delete(id); });
  }

  private notifyChanged(): void {
    this.recompute();
    window.dispatchEvent(new CustomEvent('sa-alerts-changed'));
  }

  // ─── Toolbar ───────────────────────────────────────────────────────────
  setStatus(s: StatusFilter): void { this.statusFilter = s; this.recompute(); }
  setSev(s: 'ALL' | Severity): void { this.sevFilter = s; this.recompute(); }
  setSort(s: SortKey): void { this.sort = s; this.recompute(); }
  onSearch(): void { this.recompute(); }
  toggleGroup(): void { this.groupByWell = !this.groupByWell; }

  // ─── Card helpers ────────────────────────────────────────────────────────
  isExpanded(id: string): boolean { return !!this.expanded[id]; }
  toggleExpand(id: string): void { this.expanded[id] = !this.expanded[id]; }

  /** Alerts on the same well (context "history on this entity"), excluding this one. */
  historyFor(a: EnrichedAlert): EnrichedAlert[] { return this.all.filter(x => x.well === a.well && x.id !== a.id); }

  currentValue(a: EnrichedAlert): string { return a.pct != null ? ('Progress ' + a.pct + '%') : ''; }

  slaLabel(a: EnrichedAlert): string {
    if (!a.hasSla) return 'No SLA';
    const neg = a.msLeft < 0;
    let s = Math.abs(a.msLeft) / 1000;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    const txt = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return neg ? `Overdue ${txt}` : `${txt} left`;
  }
  slaClass(a: EnrichedAlert): string {
    if (!a.hasSla) return 'none';
    if (a.effectiveStatus === 'closed') return 'done';
    if (a.breached) return 'breached';
    if (a.atRisk) return 'risk';
    return 'ok';
  }
  sevClass(sev: Severity): string { return 'sau-sev sau-sev--' + (sev || '').toLowerCase(); }

  fmtWhen(ts?: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => (n < 10 ? '0' + n : '' + n);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return `${p(d.getDate())}-${mon} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  suggestion(a: EnrichedAlert): string { return suggestedResolution(a); }

  // ─── Actions ─────────────────────────────────────────────────────────────
  ack(a: EnrichedAlert): void { ackAlert(a.id, this.me, this.now); this.notifyChanged(); }
  snooze(a: EnrichedAlert, hours: number): void { snoozeAlert(a.id, this.now + hours * 3600 * 1000); this.notifyChanged(); }
  reopen(a: EnrichedAlert): void { reopenAlert(a.id); this.notifyChanged(); }

  // Close (single or bulk) via modal.
  openClose(a: EnrichedAlert): void {
    this.closeModal = { open: true, ids: [a.id], single: a, resolution: this.suggestion(a) || '', note: '' };
  }
  openBulkClose(): void {
    const ids = [...this.selected];
    if (!ids.length) return;
    this.closeModal = { open: true, ids, resolution: '', note: '' };
  }
  confirmClose(): void {
    const { ids, resolution, note } = this.closeModal;
    if (!resolution) return;
    ids.forEach(id => closeAlertWithReason(id, resolution, note, this.now));
    this.closeModal = { open: false, ids: [], resolution: '', note: '' };
    this.selected.clear();
    this.notifyChanged();
  }
  cancelClose(): void { this.closeModal = { open: false, ids: [], resolution: '', note: '' }; }

  // Reassign via modal.
  openReassign(a: EnrichedAlert): void { this.reassignModal = { open: true, id: a.id, assignee: a.state.assignee || '' }; }
  confirmReassign(): void {
    if (this.reassignModal.assignee) { reassignAlert(this.reassignModal.id, this.reassignModal.assignee); }
    this.reassignModal = { open: false, id: '', assignee: '' };
    this.notifyChanged();
  }
  cancelReassign(): void { this.reassignModal = { open: false, id: '', assignee: '' }; }

  // Comments (collaboration).
  postComment(a: EnrichedAlert): void {
    const text = (this.commentDraft[a.id] || '').trim();
    if (!text) return;
    addComment(a.id, this.me, text, this.now);
    this.commentDraft[a.id] = '';
    this.notifyChanged();
    this.expanded[a.id] = true;
  }

  // Drill to the well the alert fired on.
  openWell(a: EnrichedAlert): void {
    try { (window as any).__saDrillWell = a.well; } catch { /* noop */ }
    this.router.navigate(['/allwells'], { queryParams: { well: a.well } });
  }

  // ─── Bulk selection ──────────────────────────────────────────────────────
  isSelected(id: string): boolean { return this.selected.has(id); }
  toggleSelect(id: string, ev?: Event): void { ev?.stopPropagation(); if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); }
  clearSelection(): void { this.selected.clear(); }
  selectAllVisible(): void { this.flat.forEach(a => { if (a.effectiveStatus !== 'closed') this.selected.add(a.id); }); }
  bulkAck(): void { [...this.selected].forEach(id => ackAlert(id, this.me, this.now)); this.selected.clear(); this.notifyChanged(); }
  bulkSnooze(hours: number): void { [...this.selected].forEach(id => snoozeAlert(id, this.now + hours * 3600 * 1000)); this.selected.clear(); this.notifyChanged(); }

  trackById = (_: number, a: EnrichedAlert) => a.id;

  // ─── Admin legacy path ────────────────────────────────────────────────────
  private mergeAdminLegacy(): void {
    const w = window as any;
    if (!Array.isArray(w.saAlertsData)) return;
    if (!Array.isArray(w.__saBaseAlerts)) w.__saBaseAlerts = w.saAlertsData.slice();
    w.__saIsAdmin = true;
    const role = this.auth.currentUser?.role;
    const ruleAlerts = openAlertsForViewer(role).map(a => ({
      id: a.id, sev: a.sev, cat: a.cat, catClass: a.catClass, due: a.due,
      title: a.title, desc: a.desc + '  ·  Assigned to — ' + a.scopeLabel,
      well: a.well, time: a.time, user: a.user, pct: a.pct, slaText: a.slaText
    }));
    const base = w.__saBaseAlerts.map((b: any, i: number) => ({ ...b, id: b.id || ('base-' + i), slaText: b.slaText || '' }));
    w.saAlertsData = [...ruleAlerts, ...base];
  }
}
