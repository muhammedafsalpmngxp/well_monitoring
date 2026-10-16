import { Component, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AlertRuleService, RuleSeverity, TriggerCondition } from '../alert-rule.service';

export interface RecipientOption {
  key: string;
  icon: 'sparkles' | 'user' | 'search-user' | 'group' | 'calendar-clock';
  title: string;
  description: string;
  configTitle: string;
  configDescription: string;
}

const RECIPIENT_OPTIONS: RecipientOption[] = [
  {
    key: 'smart-assignment', icon: 'sparkles',
    title: 'Smart assignment',
    description: 'Automatically sends each alert to the best-fit owner or responsible role.',
    configTitle: 'Smart assignment configuration',
    configDescription: 'T-Wise selects the most relevant recipient using the affected well, site, crew and rule context. If no owner is found, it uses the responsible role as a fallback. No manual recipient setup is required.',
  },
  {
    key: 'entity-owners', icon: 'user',
    title: 'Entity owners',
    description: 'Sends the alert to the owner of the affected well, site, or crew.',
    configTitle: 'Entity owners configuration',
    configDescription: 'Alerts route directly to whoever is set as the owner for the affected well, site, or crew. Configure ownership under Entity settings.',
  },
  {
    key: 'employee-attributes', icon: 'search-user',
    title: 'Employee attributes',
    description: 'Matches recipients using role, cluster, site or discipline.',
    configTitle: 'Employee attributes configuration',
    configDescription: 'Matches alerts to employees using role, cluster, site, or discipline tags. Configure attribute mappings under Employee settings.',
  },
  {
    key: 'groups', icon: 'group',
    title: 'Groups',
    description: 'Notifies a selected team or distribution group.',
    configTitle: 'Groups configuration',
    configDescription: 'Sends alerts to a selected team or distribution group. Choose the target group under Group settings.',
  },
  {
    key: 'on-call-schedules', icon: 'calendar-clock',
    title: 'On-call schedules',
    description: 'Notifies the people currently on shift in the selected schedules.',
    configTitle: 'On-call schedules configuration',
    configDescription: 'Notifies whoever is currently on shift according to the selected on-call schedule. Configure schedules under On-call settings.',
  },
];

const TRIGGER_CONDITION_TEMPLATE: TriggerCondition = {
  title: 'Rig-on date is within',
  description: 'The rig on-site (spud) date is within the lead window.',
  value: '7',
};

@Component({
  selector: 'app-alert-rule-builder',
  standalone: false,
  templateUrl: './alert-rule-builder.component.html',
  styleUrls: ['./alert-rule-builder.component.scss'],
})
export class AlertRuleBuilderComponent {
  ruleName = '';

  severityOptions: RuleSeverity[] = ['Critical', 'High', 'Medium', 'Low', 'Info'];
  severity: RuleSeverity = 'Critical';
  severityMenuOpen = false;

  resolutionSlaHours = 24;

  triggerLogicOptions: { value: 'OR' | 'AND'; label: string }[] = [
    { value: 'OR', label: 'Any condition is met (OR)' },
    { value: 'AND', label: 'All conditions must be met (AND)' },
  ];
  triggerLogic: 'OR' | 'AND' = 'OR';
  triggerLogicMenuOpen = false;

  triggerConditions: TriggerCondition[] = [
    { ...TRIGGER_CONDITION_TEMPLATE },
    { ...TRIGGER_CONDITION_TEMPLATE },
    { ...TRIGGER_CONDITION_TEMPLATE },
  ];

  recipientOptions = RECIPIENT_OPTIONS;
  selectedRecipientKey = RECIPIENT_OPTIONS[0].key;

  enableRule = false;

  readonly flagPath1 = 'M4.33333 8C2.58333 8 2 8.58333 2 8.58333V1.58333C2 1.58333 2.58333 1 4.33333 1C6.08333 1 7.25 2.16667 9 2.16667C10.75 2.16667 11.3333 1.58333 11.3333 1.58333V8.58333C11.3333 8.58333 10.75 9.16667 9 9.16667C7.25 9.16667 6.08333 8 4.33333 8Z';
  readonly flagPath2 = 'M2 8.58333C2 8.58333 2.58333 8 4.33333 8C6.08333 8 7.25 9.16667 9 9.16667C10.75 9.16667 11.3333 8.58333 11.3333 8.58333V1.58333C11.3333 1.58333 10.75 2.16667 9 2.16667C7.25 2.16667 6.08333 1 4.33333 1C2.58333 1 2 1.58333 2 1.58333V12.6667';

  constructor(private readonly alertRuleService: AlertRuleService, private readonly router: Router) {}

  get severityStyle(): { bg: string; color: string; border: string } {
    const s: Record<string, { bg: string; color: string; border: string }> = {
      Critical: { bg: '#FDECEC', color: '#C62828', border: '#F8C7C6' },
      High:     { bg: '#FFF4E8', color: '#B54708', border: '#FFD9AD' },
      Medium:   { bg: '#FFF8E1', color: '#8A5A00', border: '#F3E6BF' },
      Low:      { bg: '#EEF8EE', color: '#1B7A3A', border: '#B7ECBA' },
      Info:     { bg: '#ECF7FF', color: '#1565C0', border: '#C3E4FF' },
    };
    return s[this.severity] ?? s['Info'];
  }

  get selectedRecipientOption(): RecipientOption {
    return this.recipientOptions.find(o => o.key === this.selectedRecipientKey) ?? this.recipientOptions[0];
  }

  get canCreate(): boolean {
    return this.ruleName.trim().length > 0 && this.triggerConditions.length > 0;
  }

  toggleSeverityMenu(): void { this.severityMenuOpen = !this.severityMenuOpen; }
  selectSeverity(sev: RuleSeverity): void { this.severity = sev; this.severityMenuOpen = false; }

  toggleTriggerLogicMenu(): void { this.triggerLogicMenuOpen = !this.triggerLogicMenuOpen; }
  selectTriggerLogic(value: 'OR' | 'AND'): void { this.triggerLogic = value; this.triggerLogicMenuOpen = false; }

  triggerLogicLabel(): string {
    return this.triggerLogicOptions.find(o => o.value === this.triggerLogic)?.label ?? '';
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.severityMenuOpen = false;
    this.triggerLogicMenuOpen = false;
  }

  addCondition(): void {
    this.triggerConditions.push({ ...TRIGGER_CONDITION_TEMPLATE });
  }

  removeCondition(index: number): void {
    this.triggerConditions.splice(index, 1);
  }

  selectRecipient(key: string): void { this.selectedRecipientKey = key; }

  cancel(): void {
    this.router.navigate(['/smart-alerts/alert-rule-configuration']);
  }

  createRule(): void {
    if (!this.canCreate) return;
    const recipient = this.selectedRecipientOption;
    const created = this.alertRuleService.createRule({
      ruleName: this.ruleName.trim(),
      severity: this.severity,
      triggerConditions: this.triggerConditions.map(c => ({ ...c, value: `${c.value} day` })),
      recipientRouting: recipient.title,
      recipientDescription: recipient.description,
      resolutionSla: `${this.resolutionSlaHours} hours`,
      enabled: this.enableRule,
    });
    this.router.navigate(['/smart-alerts/alert-rule-configuration', created.id]);
  }
}
