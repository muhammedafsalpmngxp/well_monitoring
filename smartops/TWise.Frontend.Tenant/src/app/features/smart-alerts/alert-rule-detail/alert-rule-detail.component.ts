import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertRule, AlertRuleService } from '../alert-rule.service';

@Component({
  selector: 'app-alert-rule-detail',
  standalone: false,
  templateUrl: './alert-rule-detail.component.html',
  styleUrls: ['./alert-rule-detail.component.scss'],
})
export class AlertRuleDetailComponent implements OnInit {
  rule?: AlertRule;
  showDeleteConfirm = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly alertRuleService: AlertRuleService,
  ) {}

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.rule = this.alertRuleService.getRuleById(id);
  }

  goBack(): void {
    this.router.navigate(['/smart-alerts/alert-rule-configuration']);
  }

  toggleRule(): void {
    if (this.rule) this.rule.enabled = !this.rule.enabled;
  }

  requestDelete(): void { this.showDeleteConfirm = true; }
  cancelDelete(): void { this.showDeleteConfirm = false; }

  confirmDelete(): void {
    if (this.rule) this.alertRuleService.deleteRule(this.rule.id);
    this.showDeleteConfirm = false;
    this.goBack();
  }
}
