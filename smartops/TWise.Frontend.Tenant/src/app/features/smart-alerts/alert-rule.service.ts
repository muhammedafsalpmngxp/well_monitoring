import { Injectable } from '@angular/core';

export type RuleSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

export interface TriggerCondition {
  title: string;
  description: string;
  value: string;
}

export interface AlertRule {
  id: number;
  ruleName: string;
  severity: RuleSeverity;
  secondaryTag?: RuleSeverity;
  triggerConditions: TriggerCondition[];
  recipientRouting: string;
  recipientDescription: string;
  resolutionSla: string;
  createdAt: string;
  enabled: boolean;
  selected: boolean;
}

export type NewAlertRule = Omit<AlertRule, 'id' | 'createdAt' | 'selected'>;

export interface RuleStatTile {
  severity: RuleSeverity;
  value: number;
}

const SEVERITY_CYCLE: RuleSeverity[] = [
  'Critical', 'Low', 'High', 'Medium', 'Info', 'Low', 'Critical', 'Medium', 'Low', 'Info',
  'High', 'Critical', 'Medium', 'Info', 'Low',
];

const SECONDARY_TAG: Record<RuleSeverity, RuleSeverity> = {
  Critical: 'Low',
  High: 'Medium',
  Medium: 'High',
  Low: 'Critical',
  Info: 'Medium',
};

const TRIGGER_CONDITION_TEMPLATE: TriggerCondition = {
  title: 'Rig-on date is within',
  description: 'The rig on-site (spud) date is within the lead window.',
  value: '7 day',
};

function buildMockRules(count: number): AlertRule[] {
  return Array.from({ length: count }, (_, i) => {
    const severity = SEVERITY_CYCLE[i % SEVERITY_CYCLE.length];
    return {
      id: i + 1,
      ruleName: 'Well progress behind plan',
      severity,
      secondaryTag: SECONDARY_TAG[severity],
      triggerConditions: [
        { ...TRIGGER_CONDITION_TEMPLATE },
        { ...TRIGGER_CONDITION_TEMPLATE },
        { ...TRIGGER_CONDITION_TEMPLATE },
      ],
      recipientRouting: 'Smart assignment',
      recipientDescription: 'Automatically sends each alert to the best-fit owner or responsible role.',
      resolutionSla: '24 hours',
      createdAt: '28-May-2026, 09:00',
      enabled: true,
      selected: false,
    };
  });
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCreatedAt(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_NAMES[date.getMonth()];
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}-${month}-${date.getFullYear()}, ${hours}:${minutes}`;
}

@Injectable({ providedIn: 'root' })
export class AlertRuleService {
  readonly rules: AlertRule[] = buildMockRules(45);
  private nextId = this.rules.length + 1;

  getRuleById(id: number): AlertRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  deleteRule(id: number): void {
    const index = this.rules.findIndex(r => r.id === id);
    if (index !== -1) this.rules.splice(index, 1);
  }

  createRule(rule: NewAlertRule): AlertRule {
    const created: AlertRule = { ...rule, id: this.nextId++, createdAt: formatCreatedAt(new Date()), selected: false };
    this.rules.unshift(created);
    return created;
  }
}
