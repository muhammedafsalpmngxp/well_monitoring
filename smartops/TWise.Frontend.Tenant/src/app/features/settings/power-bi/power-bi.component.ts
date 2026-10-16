import { ChangeDetectorRef, Component, DestroyRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PowerBIReportEmbedComponent } from 'powerbi-client-angular';
import { IReportEmbedConfiguration, models } from 'powerbi-client';
import { PowerBiReport, PowerBiService, PowerBiSettings, SavePowerBiSettingsRequest } from '../../../core/services/power-bi.service';
import { PermissionService } from '../../../core/services/permission.service';

/** Refresh the embed token this long before it expires; Power BI recommends renewing early. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const REFRESH_CHECK_MS = 60 * 1000;

/**
 * Power BI "embed for your customers": the tenant stores one service principal, then any report
 * in its workspace can be viewed here without the viewer holding a Power BI licence.
 *
 * The browser only ever receives a view-only embed token for the selected report; the Azure AD
 * token and client secret stay on the server. The embed token is renewed on a timer, because the
 * Power BI iframe uses it directly and an HTTP interceptor cannot reach it.
 */
@Component({
  selector: 'app-power-bi',
  standalone: false,
  templateUrl: './power-bi.component.html',
  styleUrls: ['./power-bi.component.scss'],
})
export class PowerBiComponent implements OnInit, OnDestroy {
  private readonly permissions = inject(PermissionService);

  get canConfigure(): boolean {
    return this.permissions.canView('settings.power-bi') && (this.settings
      ? this.permissions.canModify('settings.power-bi')
      : this.permissions.canCreate('settings.power-bi'));
  }

  private readonly destroyRef = inject(DestroyRef);
  @ViewChild(PowerBIReportEmbedComponent) private embed?: PowerBIReportEmbedComponent;

  settings: PowerBiSettings | null = null;
  reports: PowerBiReport[] = [];
  selected: PowerBiReport | null = null;
  embedConfig: IReportEmbedConfiguration | null = null;

  loading = false;
  error = '';

  /** Connection dialog. */
  showForm = false;
  saving = false;
  formError = '';
  form: SavePowerBiSettingsRequest = { azureTenantId: '', clientId: '', workspaceId: '', clientSecret: '' };

  private tokenExpiry = 0;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly powerBi: PowerBiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.powerBi.getSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => { this.settings = settings; if (settings) this.loadReports(); this.cdr.markForCheck(); },
        error: (err) => this.fail(err, 'The Power BI settings could not be loaded.'),
      });
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshTimer);
  }

  loadReports(): void {
    this.loading = true;
    this.error = '';
    this.powerBi.getReports()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reports) => { this.reports = reports; this.loading = false; this.cdr.markForCheck(); },
        error: (err) => { this.loading = false; this.fail(err, 'The reports could not be listed.'); },
      });
  }

  view(report: PowerBiReport): void {
    this.selected = report;
    this.embedConfig = null;
    this.error = '';
    this.powerBi.getEmbedConfig(report.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config) => {
          this.tokenExpiry = Date.parse(config.expiration);
          this.embedConfig = {
            type: 'report',
            id: config.reportId,
            embedUrl: config.embedUrl,
            accessToken: config.embedToken,
            tokenType: models.TokenType.Embed,
            settings: { background: models.BackgroundType.Transparent, panes: { filters: { visible: false } } },
          };
          this.startTokenRefresh();
          this.cdr.markForCheck();
        },
        error: (err) => this.fail(err, 'The report could not be embedded.'),
      });
  }

  closeReport(): void {
    this.selected = null;
    this.embedConfig = null;
    clearInterval(this.refreshTimer);
  }

  openForm(): void {
    if (!this.canConfigure) return;
    const s = this.settings;
    this.form = { azureTenantId: s?.azureTenantId ?? '', clientId: s?.clientId ?? '', workspaceId: s?.workspaceId ?? '', clientSecret: '' };
    this.formError = '';
    this.showForm = true;
  }

  closeForm(): void {
    if (!this.saving) this.showForm = false;
  }

  save(): void {
    if (!this.canConfigure) return;
    this.saving = true;
    this.formError = '';
    this.powerBi.saveSettings({
      azureTenantId: this.form.azureTenantId.trim(),
      clientId: this.form.clientId.trim(),
      workspaceId: this.form.workspaceId.trim(),
      clientSecret: this.form.clientSecret?.trim() || null,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.saving = false;
          this.showForm = false;
          this.settings = settings;
          this.closeReport();
          this.loadReports();
        },
        error: (err) => {
          this.saving = false;
          this.formError = err?.error?.message ?? 'The settings could not be saved.';
          this.cdr.markForCheck();
        },
      });
  }

  get canSave(): boolean {
    const f = this.form;
    return this.canConfigure && !!(f.azureTenantId.trim() && f.clientId.trim() && f.workspaceId.trim() && (f.clientSecret?.trim() || this.settings?.hasSecret));
  }

  /** Renews the embed token before expiry and hands it to the running report. */
  private startTokenRefresh(): void {
    clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      if (!this.selected || Date.now() < this.tokenExpiry - REFRESH_MARGIN_MS) return;
      this.powerBi.getEmbedConfig(this.selected.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (config) => {
            this.tokenExpiry = Date.parse(config.expiration);
            this.embed?.getReport()?.setAccessToken(config.embedToken);
          },
          error: (err) => this.fail(err, 'The embed token could not be renewed.'),
        });
    }, REFRESH_CHECK_MS);
  }

  private fail(err: any, fallback: string): void {
    this.error = err?.error?.message ?? fallback;
    this.cdr.markForCheck();
  }
}
