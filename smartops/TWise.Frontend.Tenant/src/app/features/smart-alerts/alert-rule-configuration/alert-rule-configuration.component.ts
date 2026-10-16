import { Component } from '@angular/core';
import { Router } from '@angular/router';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  RowSelectionModule,
  RowSelectionOptions,
  SelectionColumnDef,
  themeQuartz,
} from 'ag-grid-community';
import { AlertRule, AlertRuleService, RuleSeverity, RuleStatTile } from '../alert-rule.service';
import { ArcRuleNameRendererComponent } from './cell-renderers/arc-rule-name-renderer.component';
import { ArcTriggerRendererComponent } from './cell-renderers/arc-trigger-renderer.component';
import { ArcSeverityRendererComponent } from './cell-renderers/arc-severity-renderer.component';
import { ArcStatusRendererComponent } from './cell-renderers/arc-status-renderer.component';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

export const ARC_GRID_THEME = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#E7ECF3',
  borderRadius: 0,
  checkboxBorderRadius: 4,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#F9FAFB',
  headerTextColor: '#667085',
  headerFontWeight: 600,
  rowHoverColor: '#F5F8FF',
  selectedRowBackgroundColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

@Component({
  selector: 'app-alert-rule-configuration',
  standalone: false,
  templateUrl: './alert-rule-configuration.component.html',
  styleUrls: ['./alert-rule-configuration.component.scss'],
})
export class AlertRuleConfigurationComponent {
  isExpanded = false;

  statTiles: RuleStatTile[] = [
    { severity: 'Critical', value: 6 },
    { severity: 'High', value: 2 },
    { severity: 'Medium', value: 4 },
    { severity: 'Low', value: 4 },
    { severity: 'Info', value: 4 },
  ];

  severityOptions: RuleSeverity[] = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  rules: AlertRule[];

  searchTerm = '';
  selectedSeverity: RuleSeverity | 'All' = 'All';
  pageSize = 20;
  currentPage = 1;

  // ─── AG Grid ────────────────────────────────────────────────────────────
  readonly gridTheme = ARC_GRID_THEME;

  readonly columnDefs: ColDef<AlertRule>[] = [
    { headerName: 'SI No.',            field: 'id',               minWidth: 80,  maxWidth: 90 },
    { headerName: 'Rule Name',         field: 'ruleName',         minWidth: 200, flex: 2,
      cellRenderer: ArcRuleNameRendererComponent },
    { headerName: 'Trigger condition', field: 'triggerConditions',minWidth: 280, flex: 2,
      cellDataType: false, cellRenderer: ArcTriggerRendererComponent },
    { headerName: 'Recipient routing', field: 'recipientRouting', minWidth: 160, flex: 1 },
    { headerName: 'Severity',          field: 'severity',         minWidth: 130,
      cellRenderer: ArcSeverityRendererComponent },
    { headerName: 'Resolution SLA',    field: 'resolutionSla',    minWidth: 140, flex: 1 },
    { headerName: 'Status',            field: 'enabled',          minWidth: 100, maxWidth: 110,
      cellRenderer: ArcStatusRendererComponent },
  ];

  readonly defaultColDef: ColDef<AlertRule> = { sortable: true, resizable: true, flex: 1 };

  readonly rowSelection: RowSelectionOptions<AlertRule> = {
    mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: false,
  };

  readonly selectionColumnDef: SelectionColumnDef = {
    width: 48, maxWidth: 48, minWidth: 48,
    suppressHeaderMenuButton: true, suppressMovable: true,
  };

  readonly gridContext = {
    onOpen: (rule: AlertRule) => this.openRule(rule),
  };

  constructor(private readonly alertRuleService: AlertRuleService, private readonly router: Router) {
    this.rules = this.alertRuleService.rules;
  }

  get filteredRules(): AlertRule[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.rules.filter(r => {
      if (this.selectedSeverity !== 'All' && r.severity !== this.selectedSeverity) return false;
      if (term && !r.ruleName.toLowerCase().includes(term)) return false;
      return true;
    });
  }

  get totalCount(): number { return this.filteredRules.length; }
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalCount / this.pageSize)); }
  get rangeStart(): number { return this.totalCount === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1; }
  get rangeEnd(): number { return Math.min(this.currentPage * this.pageSize, this.totalCount); }

  get pagedRules(): AlertRule[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRules.slice(start, start + this.pageSize);
  }

  get allPagedSelected(): boolean {
    return this.pagedRules.length > 0 && this.pagedRules.every(r => r.selected);
  }

  severityCount(sev: RuleSeverity | 'All'): number {
    if (sev === 'All') return this.rules.length;
    return this.rules.filter(r => r.severity === sev).length;
  }

  setSeverity(sev: RuleSeverity | 'All'): void {
    this.selectedSeverity = sev;
    this.currentPage = 1;
  }

  goToFirstPage(): void { this.currentPage = 1; }
  goToPrevPage(): void { this.currentPage = Math.max(1, this.currentPage - 1); }
  goToNextPage(): void { this.currentPage = Math.min(this.totalPages, this.currentPage + 1); }
  goToLastPage(): void { this.currentPage = this.totalPages; }

  toggleRule(rule: AlertRule): void { rule.enabled = !rule.enabled; }
  toggleSelect(rule: AlertRule): void { rule.selected = !rule.selected; }

  toggleSelectAllPaged(): void {
    const next = !this.allPagedSelected;
    this.pagedRules.forEach(r => r.selected = next);
  }

  toggleExpand(): void { this.isExpanded = !this.isExpanded; }

  openRule(rule: AlertRule): void {
    this.router.navigate(['/smart-alerts/alert-rule-configuration', rule.id]);
  }

  createNewRule(): void {
    this.router.navigate(['/smart-alerts/alert-rule-configuration/create']);
  }
}
