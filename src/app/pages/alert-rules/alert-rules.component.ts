import { Component, AfterViewInit, OnDestroy, OnInit, HostListener, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import {
  AlertRule, ConditionDef, RuleCondition, Severity, MatchMode, RuleScope, AssignMethod, AttrField,
  CONDITIONS, getCondition, ROLE_OPTIONS, USER_OPTIONS, CLUSTER_OPTIONS, PLANT_OPTIONS, WELL_OPTIONS,
  ATTR_FIELDS, OWNER_TARGETS, ESCALATION_TIERS, GROUP_OPTIONS, ONCALL_OPTIONS, ASSIGN_METHODS, assignMethodLabel,
  emptyScope, defaultAttribute, defaultOwnership, defaultGroups, defaultOncall,
  scopeSummary, assignmentSummary, conditionsSummary, getAllRules, getRule, saveRule, deleteRule, setRuleEnabled
} from '../../features/alert-rules/alert-rules';

/** Scope dimensions rendered as multi-select dropdowns in the editor. */
interface ScopeDim { key: keyof RuleScope; label: string; options: string[]; }

/**
 * Smart Alert Rule Configuration.
 * Rules are listed in a grid (Sl No, Created, Rule name, Scenario, Severity,
 * Assigned to, Actions). Clicking a rule opens a read-only detail popup.
 * "Create new rule" opens a generic builder: compose a rule from one or more
 * predefined conditions (match ALL/ANY), set thresholds, and multi-select the
 * assignment (roles / users / clusters / sites / wells). Enabled rules drive
 * the Smart Alerts page.
 */
@Component({
  selector: 'app-alert-rules',
  templateUrl: './alert-rules.component.html',
  styleUrls: ['./alert-rules.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AlertRulesComponent implements OnInit, AfterViewInit, OnDestroy {

  conditionCatalogue = CONDITIONS;
  sevOptions: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

  scopeDims: ScopeDim[] = [
    { key: 'roles', label: 'Roles', options: ROLE_OPTIONS },
    { key: 'users', label: 'Users', options: USER_OPTIONS },
    { key: 'clusters', label: 'Clusters', options: CLUSTER_OPTIONS },
    { key: 'plants', label: 'Sites / Plants', options: PLANT_OPTIONS },
    { key: 'wells', label: 'Wells', options: WELL_OPTIONS }
  ];

  // Assignment-method metadata + per-method option lists.
  assignMethods = ASSIGN_METHODS;
  attrFields: AttrField[] = ATTR_FIELDS;
  ownerTargets = OWNER_TARGETS;
  escalationTiers = ESCALATION_TIERS;
  groupOptions = GROUP_OPTIONS;
  oncallOptions = ONCALL_OPTIONS;
  methodLabel = assignMethodLabel;

  private grid: any = null;
  private rules: AlertRule[] = [];

  detailRule: AlertRule | null = null;

  editorOpen = false;
  editing: AlertRule | null = null;
  editorModel: AlertRule = this.blankModel();
  openDd: string | null = null;         // open scope dropdown
  addConditionKey = '';                 // "add condition" picker value

  constructor(private router: Router, private auth: AuthService) {}

  ngOnInit(): void {
    // Rule configuration is admin-only; other roles are sent to Smart Alerts.
    if ((this.auth.currentUser?.role || '').toLowerCase() !== 'admin') {
      this.router.navigateByUrl('/smartalerts');
      return;
    }
    this.rules = getAllRules();
  }
  ngAfterViewInit(): void { setTimeout(() => this.renderGrid(), 40); }
  ngOnDestroy(): void { this.destroyGrid(); }

  back(): void { this.router.navigateByUrl('/smartalerts'); }

  /* ── template helpers ── */
  condLabel(key: string): string { return getCondition(key)?.label || key; }
  condSummary(key: string): string { return getCondition(key)?.summary || ''; }
  condParams(key: string): ConditionDef['params'] { return getCondition(key)?.params || []; }
  scopeText(scope: RuleScope): string { return scopeSummary(scope); }
  assignText(rule: AlertRule): string { return assignmentSummary(rule); }
  rulesConditions(rule: AlertRule): string { return conditionsSummary(rule); }
  sevClass(sev: Severity): string { return 'ar-sev ar-sev--' + (sev || '').toLowerCase(); }

  private fmtDate(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    const p = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${p(d.getDate())}-${mon}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ── grid ── */
  private destroyGrid(): void { if (this.grid) { try { this.grid.destroy(); } catch { /* noop */ } this.grid = null; } }

  private renderGrid(): void {
    this.destroyGrid();
    const el = document.getElementById('arGrid');
    const agGrid = (window as any).agGrid;
    if (!el || !agGrid) return;
    const dk = !document.documentElement.classList.contains('navbar-light');
    el.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' ar-grid';
    el.style.height = '100%';

    const openDetail = (id: string) => this.openDetail(id);
    const setEnabled = (id: string, on: boolean) => { setRuleEnabled(id, on); this.refresh(); };

    const opts = {
      columnDefs: [
        { headerName: 'Sl No', width: 84, sortable: false, filter: false,
          valueGetter: (p: any) => (p.node?.rowIndex ?? 0) + 1, cellClass: 'ar-slno' },
        { headerName: 'Created', field: 'createdText', width: 168 },
        { headerName: 'Rule name', field: 'name', flex: 1.4, minWidth: 210,
          cellRenderer: (p: any) =>
            `<span class="ar-gname">${p.value}</span>` + (p.data.builtIn ? ` <span class="ar-gbuiltin">Built-in</span>` : '') },
        { headerName: 'Scenario', field: 'scenario', flex: 1.7, minWidth: 240 },
        { headerName: 'Severity', field: 'severity', width: 118,
          cellRenderer: (p: any) => `<span class="ar-sev ar-sev--${(p.value || '').toLowerCase()}">${p.value}</span>` },
        { headerName: 'Assigned to', field: 'scope', flex: 1.6, minWidth: 210 },
        { headerName: 'Actions', width: 230, sortable: false, filter: false,
          cellRenderer: (p: any) =>
            `<button class="ar-rowbtn" data-act="view">View</button>` +
            `<button class="ar-rowbtn ar-rowbtn--ok" data-act="enable"${p.data.enabled ? ' disabled' : ''}>Enable</button>` +
            `<button class="ar-rowbtn ar-rowbtn--warn" data-act="disable"${!p.data.enabled ? ' disabled' : ''}>Disable</button>`,
          onCellClicked: (p: any) => {
            const act = (p.event.target as HTMLElement)?.getAttribute('data-act');
            if (act === 'view') openDetail(p.data.id);
            else if (act === 'enable') setEnabled(p.data.id, true);
            else if (act === 'disable') setEnabled(p.data.id, false);
          } }
      ],
      rowData: this.gridRows(),
      defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 90 },
      rowHeight: 46,
      animateRows: true,
      onRowClicked: (p: any) => {
        if ((p.event.target as HTMLElement)?.closest('.ar-rowbtn')) return;
        openDetail(p.data.id);
      }
    };
    this.grid = agGrid.createGrid(el, opts);
  }

  private gridRows(): any[] {
    return this.rules.map(r => ({
      id: r.id, name: r.name, scenario: conditionsSummary(r),
      severity: r.severity, enabled: r.enabled, scope: assignmentSummary(r),
      createdText: this.fmtDate(r.createdAt), builtIn: !!r.builtIn
    }));
  }

  private refresh(): void {
    this.rules = getAllRules();
    if (this.grid) this.grid.setGridOption('rowData', this.gridRows());
  }

  /* ── detail popup ── */
  openDetail(id: string): void { this.detailRule = getRule(id) || null; }
  closeDetail(): void { this.detailRule = null; }
  detailScope(dim: ScopeDim): string[] { return this.detailRule ? this.detailRule.scope[dim.key] : []; }
  detailConditionParams(c: RuleCondition): Array<{ label: string; value: any; unit: string }> {
    const def = getCondition(c.key); if (!def) return [];
    return def.params.map(p => ({ label: p.label, value: c.params[p.key], unit: p.unit }));
  }
  toggleDetail(): void {
    if (!this.detailRule) return;
    setRuleEnabled(this.detailRule.id, !this.detailRule.enabled);
    this.detailRule = getRule(this.detailRule.id) || null;
    this.refresh();
  }
  editFromDetail(): void { if (this.detailRule) { const r = this.detailRule; this.closeDetail(); this.edit(r); } }
  deleteFromDetail(): void { if (this.detailRule) { const r = this.detailRule; this.closeDetail(); this.remove(r); } }

  /* ── editor modal ── */
  private blankModel(): AlertRule {
    return {
      id: '', name: '', severity: 'HIGH', match: 'ALL', conditions: [], slaHours: 24, enabled: true,
      assignMethod: 'scope', scope: emptyScope(),
      attribute: defaultAttribute(), ownership: defaultOwnership(), groups: defaultGroups(), oncall: defaultOncall(),
      createdAt: 0
    };
  }
  private defaultParams(def: ConditionDef): Record<string, number> {
    const p: Record<string, number> = {}; def.params.forEach(x => p[x.key] = x.default); return p;
  }

  newRule(): void {
    this.editing = null;
    this.editorModel = this.blankModel();
    this.addConditionKey = '';
    this.openDd = null;
    this.editorOpen = true;
  }

  edit(rule: AlertRule): void {
    if (rule.builtIn) { alert('Built-in rules can be enabled/disabled but not edited. Create a new rule to customise.'); return; }
    this.editing = rule;
    this.editorModel = {
      ...rule,
      conditions: rule.conditions.map(c => ({ key: c.key, params: { ...c.params } })),
      // Always hydrate every method's config so the editor can switch freely.
      assignMethod: rule.assignMethod || 'scope',
      scope: { roles: [...rule.scope.roles], users: [...rule.scope.users], clusters: [...rule.scope.clusters], plants: [...rule.scope.plants], wells: [...rule.scope.wells] },
      attribute: rule.attribute
        ? { match: rule.attribute.match, clauses: rule.attribute.clauses.map(c => ({ field: c.field, values: [...c.values] })) }
        : defaultAttribute(),
      ownership: rule.ownership ? { targets: [...rule.ownership.targets], escalation: [...rule.ownership.escalation] } : defaultOwnership(),
      groups: rule.groups ? { groups: [...rule.groups.groups] } : defaultGroups(),
      oncall: rule.oncall ? { schedules: [...rule.oncall.schedules] } : defaultOncall()
    };
    this.addConditionKey = '';
    this.openDd = null;
    this.editorOpen = true;
  }

  remove(rule: AlertRule): void {
    if (rule.builtIn) { alert('Built-in rules cannot be deleted.'); return; }
    if (confirm('Delete rule “' + rule.name + '”?')) { deleteRule(rule.id); this.refresh(); }
  }

  closeEditor(): void { this.editorOpen = false; this.editing = null; this.openDd = null; }

  /* condition builder */
  addCondition(): void {
    const key = this.addConditionKey; if (!key) return;
    if (this.editorModel.conditions.some(c => c.key === key)) { this.addConditionKey = ''; return; }
    const def = getCondition(key); if (!def) return;
    this.editorModel.conditions.push({ key, params: this.defaultParams(def) });
    // Prefill severity from the first condition added.
    if (this.editorModel.conditions.length === 1) this.editorModel.severity = def.suggestSeverity;
    this.addConditionKey = '';
  }
  removeCondition(i: number): void { this.editorModel.conditions.splice(i, 1); }

  /* multi-select dropdowns */
  toggleDd(key: string, ev: Event): void { ev.stopPropagation(); this.openDd = this.openDd === key ? null : key; }
  toggleScope(dim: keyof RuleScope, value: string, ev: Event): void {
    ev.stopPropagation();
    const arr = this.editorModel.scope[dim];
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
  }
  inScope(dim: keyof RuleScope, value: string): boolean { return this.editorModel.scope[dim].includes(value); }
  ddLabel(dim: ScopeDim): string {
    const arr = this.editorModel.scope[dim.key];
    if (!arr.length) return 'Any (' + dim.label.toLowerCase() + ')';
    if (arr.length <= 2) return arr.join(', ');
    return arr.length + ' selected';
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: Event): void {
    if (this.openDd && !(e.target as HTMLElement)?.closest('.ar-ms')) this.openDd = null;
  }

  /* ── assignment method ── */
  setMethod(m: AssignMethod): void { this.editorModel.assignMethod = m; this.openDd = null; }
  isMethod(m: AssignMethod): boolean { return (this.editorModel.assignMethod || 'scope') === m; }

  /** Generic multi-select toggle over a string[] (groups / on-call / owners / escalation / attr values). */
  toggleIn(arr: string[], value: string, ev: Event): void {
    ev.stopPropagation();
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
  }
  arrLabel(arr: string[], noun: string): string {
    if (!arr || !arr.length) return 'Select ' + noun + '…';
    if (arr.length <= 2) return arr.join(', ');
    return arr.length + ' selected';
  }

  /* attribute-based audience clauses */
  addAttrClause(): void { this.editorModel.attribute!.clauses.push({ field: 'role', values: [] }); }
  removeAttrClause(i: number): void { this.editorModel.attribute!.clauses.splice(i, 1); }
  attrOptions(field: string): string[] { return this.attrFields.find(f => f.key === field)?.options || []; }
  onAttrFieldChange(i: number): void { this.editorModel.attribute!.clauses[i].values = []; }
  attrHas(i: number, value: string): boolean { return this.editorModel.attribute!.clauses[i].values.includes(value); }

  saveEditor(): void {
    const m = this.editorModel;
    if (!m.name.trim()) { alert('Give the rule a name.'); return; }
    if (!m.conditions.length) { alert('Add at least one condition.'); return; }
    const method: AssignMethod = m.assignMethod || 'scope';
    // Per-method assignment validation.
    if (method === 'groups' && !(m.groups && m.groups.groups.length)) { alert('Select at least one group.'); return; }
    if (method === 'oncall' && !(m.oncall && m.oncall.schedules.length)) { alert('Select at least one on-call schedule.'); return; }
    if (method === 'ownership' && !(m.ownership && m.ownership.targets.length)) { alert('Pick at least one ownership target.'); return; }
    if (method === 'attribute' && !(m.attribute && m.attribute.clauses.some(c => c.values.length))) { alert('Add at least one attribute condition with a value.'); return; }

    const id = this.editing ? this.editing.id : 'rule-' + Date.now().toString(36);
    const rule: AlertRule = {
      id, name: m.name.trim(), severity: m.severity, match: m.match,
      conditions: m.conditions.map(c => ({ key: c.key, params: { ...c.params } })),
      slaHours: Number(m.slaHours) || 0,
      enabled: m.enabled,
      assignMethod: method,
      scope: { roles: [...m.scope.roles], users: [...m.scope.users], clusters: [...m.scope.clusters], plants: [...m.scope.plants], wells: [...m.scope.wells] },
      attribute: { match: m.attribute!.match, clauses: m.attribute!.clauses.map(c => ({ field: c.field, values: [...c.values] })) },
      ownership: { targets: [...m.ownership!.targets], escalation: [...m.ownership!.escalation] },
      groups: { groups: [...m.groups!.groups] },
      oncall: { schedules: [...m.oncall!.schedules] },
      builtIn: false, createdAt: this.editing ? this.editing.createdAt : Date.now()
    };
    saveRule(rule);
    this.closeEditor();
    this.refresh();
  }
}
