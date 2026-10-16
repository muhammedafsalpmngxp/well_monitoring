import { Component, HostListener } from '@angular/core';

export type AlertSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
export type AlertTab = 'all' | 'ack' | 'snoozed' | 'closed';
export type AlertStatus = 'active' | 'ack' | 'snoozed' | 'closed';
export type SortOrder = 'newest' | 'oldest';

export interface AlertComment {
  id: string;
  author: string;
  text: string;
  timeLabel: string;
}

export interface SmartAlertItem {
  id: string;
  orderIndex: number;
  severity: AlertSeverity;
  title: string;
  wellName: string;
  wellLink: string;
  wellId: string;
  status: AlertStatus;
  overdueLabel: string;
  why: string;
  now: string;
  escalationNote: string;
  recommendation: string;
  escalation: string;
  sourceLabel: string;
  sourceLink: string;
  snoozedUntil: string;
  selected: boolean;
  expanded: boolean;
  comments: AlertComment[];
  commentDraft: string;
}

export interface StatTile {
  label: string;
  value: string;
  icon: 'critical' | 'breaching' | 'sls' | 'closedOnTime' | 'avgResponse' | 'totalClosed';
  accent: 'red' | 'amber' | 'green' | 'blue';
}

let nextCommentId = 1;

@Component({
  selector: 'app-alerts',
  standalone: false,
  templateUrl: './alerts.component.html',
  styleUrls: ['./alerts.component.scss'],
})
export class AlertsComponent {
  statTiles: StatTile[] = [
    { label: 'Critical Open', value: '0', icon: 'critical', accent: 'red' },
    { label: 'Breaching < 1H', value: '0', icon: 'breaching', accent: 'amber' },
    { label: 'Past SLS', value: '2', icon: 'sls', accent: 'red' },
    { label: 'Closed on Time', value: '0%', icon: 'closedOnTime', accent: 'green' },
    { label: 'Avg Response', value: '0', icon: 'avgResponse', accent: 'blue' },
    { label: 'Total Closed', value: '0', icon: 'totalClosed', accent: 'green' },
  ];

  severityOptions: AlertSeverity[] = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  alerts: SmartAlertItem[] = [
    {
      id: 'a1', orderIndex: 1, severity: 'Critical', title: 'Well Progress Behind plan',
      wellName: 'Well 30750', wellLink: '#', wellId: 'P130', status: 'active',
      overdueLabel: 'Overdue 27h 42min',
      why: 'Triggered because progress is more than 8% below plan.', now: 'Progress 58%',
      escalationNote: 'Escalates to Cluster Manager if unacknowledged',
      recommendation: 'Triggered because progress is more than 8% below plan.',
      escalation: 'Triggered because progress is more than 8% below plan.',
      sourceLabel: 'Open Well 30750 grid', sourceLink: '#',
      snoozedUntil: '', selected: false, expanded: false, comments: [], commentDraft: '',
    },
    {
      id: 'a2', orderIndex: 2, severity: 'Critical', title: 'Well Progress Behind plan',
      wellName: 'Well 30750', wellLink: '#', wellId: 'P130', status: 'active',
      overdueLabel: 'Overdue 27h 42min',
      why: 'Triggered because progress is more than 8% below plan.', now: 'Progress 58%',
      escalationNote: 'Escalates to Cluster Manager if unacknowledged',
      recommendation: 'Triggered because progress is more than 8% below plan.',
      escalation: 'Triggered because progress is more than 8% below plan.',
      sourceLabel: 'Open Well 30750 grid', sourceLink: '#',
      snoozedUntil: '', selected: false, expanded: true, comments: [], commentDraft: '',
    },
  ];

  activeTab: AlertTab = 'all';
  selectedSeverity: AlertSeverity | 'All' = 'All';
  searchTerm = '';
  sortOrder: SortOrder = 'newest';
  sortMenuOpen = false;
  groupByWell = false;

  get filteredAlerts(): SmartAlertItem[] {
    const term = this.searchTerm.trim().toLowerCase();
    const list = this.alerts.filter(a => {
      if (this.activeTab !== 'all' && a.status !== this.activeTab) return false;
      if (this.selectedSeverity !== 'All' && a.severity !== this.selectedSeverity) return false;
      if (term && !a.title.toLowerCase().includes(term) && !a.wellName.toLowerCase().includes(term)) return false;
      return true;
    });
    return [...list].sort((a, b) => this.sortOrder === 'newest' ? b.orderIndex - a.orderIndex : a.orderIndex - b.orderIndex);
  }

  get groupedAlerts(): { wellName: string; alerts: SmartAlertItem[] }[] {
    const groups = new Map<string, SmartAlertItem[]>();
    for (const alert of this.filteredAlerts) {
      if (!groups.has(alert.wellName)) groups.set(alert.wellName, []);
      groups.get(alert.wellName)!.push(alert);
    }
    return Array.from(groups.entries()).map(([wellName, alerts]) => ({ wellName, alerts }));
  }

  tabCount(tab: AlertTab): number {
    if (tab === 'all') return this.alerts.length;
    return this.alerts.filter(a => a.status === tab).length;
  }

  severityCount(sev: AlertSeverity | 'All'): number {
    if (sev === 'All') return this.alerts.length;
    return this.alerts.filter(a => a.severity === sev).length;
  }

  setTab(tab: AlertTab): void { this.activeTab = tab; }
  setSeverity(sev: AlertSeverity | 'All'): void { this.selectedSeverity = sev; }

  toggleSortMenu(): void { this.sortMenuOpen = !this.sortMenuOpen; }
  closeSortMenu(): void { this.sortMenuOpen = false; }
  setSortOrder(order: SortOrder): void { this.sortOrder = order; this.sortMenuOpen = false; }

  @HostListener('document:click')
  closeMenus(): void { this.sortMenuOpen = false; }

  toggleGroupByWell(): void { this.groupByWell = !this.groupByWell; }

  toggleExpand(alert: SmartAlertItem): void { alert.expanded = !alert.expanded; }
  toggleSelect(alert: SmartAlertItem): void { alert.selected = !alert.selected; }

  statusLabel(alert: SmartAlertItem): string {
    switch (alert.status) {
      case 'active': return 'Active';
      case 'ack': return 'Acknowledged';
      case 'snoozed': return alert.snoozedUntil ? `Snoozed ${alert.snoozedUntil}` : 'Snoozed';
      case 'closed': return 'Closed';
    }
  }

  acknowledge(alert: SmartAlertItem): void { alert.status = 'ack'; }
  closeAlert(alert: SmartAlertItem): void { alert.status = 'closed'; alert.expanded = false; }

  snooze(alert: SmartAlertItem, hours: number): void {
    alert.status = 'snoozed';
    alert.snoozedUntil = hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;
  }

  addComment(alert: SmartAlertItem): void {
    const text = alert.commentDraft.trim();
    if (!text) return;
    alert.comments.push({ id: `c${nextCommentId++}`, author: 'You', text, timeLabel: 'Just now' });
    alert.commentDraft = '';
  }
}
