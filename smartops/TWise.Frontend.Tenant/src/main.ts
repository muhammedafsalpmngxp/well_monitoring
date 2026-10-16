import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';

import { ModuleRegistry, provideGlobalGridOptions } from 'ag-grid-community';

import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';

ModuleRegistry.registerModules([AllEnterpriseModule]);
// Screen readers read grid rows in DOM order; keep it matching the visual order (WCAG 1.3.2).
provideGlobalGridOptions({ ensureDomOrder: true });
LicenseManager.setLicenseKey('[TRIAL]_this_{AG_Charts_and_AG_Grid}_Enterprise_key_{AG-144337}_is_granted_for_evaluation_only___Use_in_production_is_not_permitted___Please_report_misuse_to_legal@ag-grid.com___For_help_with_purchasing_a_production_key_please_contact_info@ag-grid.com___You_are_granted_a_{Single_Application}_Developer_License_for_one_application_only___All_Front-End_JavaScript_developers_working_on_the_application_would_need_to_be_licensed___This_key_will_deactivate_on_{31 October 2026}____[v3]_[0102]_MTc5MzQwNDgwMDAwMA==1f429e9548135aefda907b918d967cc5');

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
