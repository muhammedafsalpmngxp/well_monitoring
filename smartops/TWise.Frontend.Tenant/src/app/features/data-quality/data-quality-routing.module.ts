import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DataQualityComponent } from './data-quality.component';
import { ErrorLogRulesComponent } from './error-log-rules/error-log-rules.component';
import { SelfHealingAiComponent } from './self-healing-ai/self-healing-ai.component';
import { DataDictionaryComponent } from './data-dictionary/data-dictionary.component';
import { LineageComponent } from './lineage/lineage.component';
import { AddValidationRuleComponent } from './add-validation-rule/add-validation-rule.component';
import { permissionGuard } from '../../core/guards/permission.guard';

const routes: Routes = [
  {
    path: '',
    component: DataQualityComponent,
    children: [
      { path: '', redirectTo: 'error-log-rules', pathMatch: 'full' },
      { path: 'error-log-rules', component: ErrorLogRulesComponent, canActivate: [permissionGuard], data: { permission: 'data-quality.error-log' } },
      { path: 'error-log-rules/add-rule', component: AddValidationRuleComponent, canActivate: [permissionGuard], data: { permission: 'data-quality.error-log' } },
      { path: 'self-healing-ai', component: SelfHealingAiComponent, canActivate: [permissionGuard], data: { permission: 'data-quality.self-healing' } },
      { path: 'data-dictionary', component: DataDictionaryComponent, canActivate: [permissionGuard], data: { permission: 'data-quality.data-dictionary' } },
      { path: 'lineage', component: LineageComponent, canActivate: [permissionGuard], data: { permission: 'data-quality.lineage' } },
    ],
  },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class DataQualityRoutingModule {}
