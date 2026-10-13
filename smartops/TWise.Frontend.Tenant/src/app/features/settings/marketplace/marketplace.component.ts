import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarketplaceCatalog, MarketplaceListing, MarketplaceService, SaveCatalogRequest } from '../../../core/services/marketplace.service';
import { bindCustomVisualRows, bindCustomVisualTemplate, isMultiRoleVisual } from '../../../core/services/custom-visual-binding';
import { CustomVisualDataRole } from '../../../core/services/marketplace.service';
import { registerInstalledVisuals } from '../../../core/utils/installed-visual-renderers';
import { PermissionService } from '../../../core/services/permission.service';

/** A listing with its card preview, computed once when the catalog loads. */
interface MarketplaceCard {
  listing: MarketplaceListing;
  preview: Record<string, any> | null;
}

/** Sample data the card previews are drawn with. */
const PREVIEW_DATA = {
  labels: ['North', 'East', 'South', 'West', 'Central'],
  values: [42, 68, 35, 81, 57],
  dimensionLabel: 'Region',
  measureLabel: 'Output',
};

/** Sample rows for multi-role visuals (several measures, split-by, X/Y, OHLC, levels). */
const PREVIEW_ROWS = ['North', 'East', 'South', 'West'].flatMap((region, r) => ['Day', 'Night'].map((shift, s) => ({
  Region: region, Site: `${region} ${s + 1}`, Shift: shift,
  Output: 40 + r * 12 + s * 9, Target: 55 + r * 6, Cost: 20 + r * 5 + s * 4,
  X: 10 + r * 20 + s * 7, Y: 30 + ((r * 37 + s * 23) % 50), Size: 5 + r * 3 + s * 2,
  Date: `2026-0${r + 1}-${s ? 15 : '01'}`, Open: 50 + r * 4 + s, High: 58 + r * 4 + s * 2, Low: 46 + r * 4, Close: 54 + r * 4 + s * 2,
  Lat: 18 + r * 1.6 + s * 0.7, Lon: 54 + ((r * 3 + s * 2) % 5) * 0.9,
})));
/** Sample column per role key; other roles get Region (text) or Output (number). */
const PREVIEW_COLUMNS: Record<string, string[]> = {
  category: ['Region'], split: ['Shift'], levels: ['Region', 'Site'], measures: ['Output', 'Target'], measure2: ['Target'],
  x: ['X'], y: ['Y'], size: ['Size'], color: ['Cost'], label: ['Site'],
  date: ['Date'], open: ['Open'], high: ['High'], low: ['Low'], close: ['Close'],
  latitude: ['Lat'], longitude: ['Lon'], weight: ['Output'], row: ['Shift'], groups: ['Region', 'Shift'], price: ['Close'],
};

function previewColumns(roles: CustomVisualDataRole[]): Record<string, string[]> {
  return Object.fromEntries(roles.map(role => [role.key, PREVIEW_COLUMNS[role.key] ?? [role.type === 'measure' ? 'Output' : 'Region']]));
}

/**
 * Browse registered catalogs of chart visuals and install them into this tenant.
 *
 * Catalogs are registered here by URL rather than configured in appsettings, so a tenant can add
 * a marketplace without a deployment. An installed visual is registered as a renderer at runtime,
 * so it is usable immediately.
 */
@Component({
  selector: 'app-marketplace',
  standalone: false,
  templateUrl: './marketplace.component.html',
  styleUrls: ['./marketplace.component.scss'],
})
export class MarketplaceComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  get canCreate(): boolean {
    return this.permissions.canView('settings.marketplace') && this.permissions.canCreate('settings.marketplace');
  }

  get canModify(): boolean {
    return this.permissions.canView('settings.marketplace') && this.permissions.canModify('settings.marketplace');
  }

  private readonly destroyRef = inject(DestroyRef);

  catalogs: MarketplaceCatalog[] = [];
  selectedCatalog: MarketplaceCatalog | null = null;
  cards: MarketplaceCard[] = [];
  /** Visuals per catalog for the panel headers; undefined while loading, null when the catalog failed. */
  counts: Record<string, number | null> = {};

  loading = false;
  importing = false;
  error = '';
  busyPluginId: string | null = null;

  /** Add / edit marketplace dialog. `editing` is the catalog being edited, null when adding. */
  showForm = false;
  editing: MarketplaceCatalog | null = null;
  saving = false;
  formError = '';
  form: SaveCatalogRequest = { name: '', url: '', authHeader: '', authValue: '' };

  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadCatalogs();
  }

  loadCatalogs(): void {
    this.marketplace.getCatalogs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (catalogs) => {
          this.catalogs = catalogs;
          // Keep the current selection if it still exists; otherwise fall back to the first.
          this.selectedCatalog = catalogs.find(c => c.catalogKey === this.selectedCatalog?.catalogKey) ?? catalogs[0] ?? null;
          this.selectedCatalog ? this.load() : (this.cards = []);
          this.cdr.markForCheck();
          catalogs.filter(c => !this.isOpen(c)).forEach(c => this.loadCount(c));
        },
        error: (err) => this.fail(err, 'The catalog list could not be loaded.'),
      });
  }

  isOpen(catalog: MarketplaceCatalog): boolean {
    return this.selectedCatalog?.catalogKey === catalog.catalogKey;
  }

  /** Expand one marketplace panel (collapsing the current one) or collapse it again. */
  toggle(catalog: MarketplaceCatalog): void {
    this.cards = [];
    if (this.isOpen(catalog)) {
      this.selectedCatalog = null;
      return;
    }
    this.selectedCatalog = catalog;
    this.load();
  }

  load(): void {
    if (!this.selectedCatalog) return;
    this.loading = true;
    this.error = '';
    this.marketplace.browse(this.selectedCatalog.catalogKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (listings) => {
          this.cards = listings.map(listing => ({ listing, preview: this.previewOf(listing) }));
          this.counts[this.selectedCatalog!.catalogKey] = listings.length;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => { this.loading = false; this.fail(err, 'The catalog could not be loaded.'); },
      });
  }

  /** Header count for a collapsed panel, fetched without opening it. */
  private loadCount(catalog: MarketplaceCatalog): void {
    this.marketplace.browse(catalog.catalogKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (listings) => { this.counts[catalog.catalogKey] = listings.length; this.cdr.markForCheck(); },
        error: () => { this.counts[catalog.catalogKey] = null; this.cdr.markForCheck(); },
      });
  }

  openAddForm(): void {
    if (!this.canCreate) return;
    this.editing = null;
    this.form = { name: '', url: '', authHeader: '', authValue: '' };
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(catalog: MarketplaceCatalog): void {
    if (!this.canModify) return;
    this.editing = catalog;
    // The stored secret is never returned; leaving the value blank keeps it.
    this.form = { name: catalog.name, url: catalog.url, authHeader: catalog.authHeader ?? '', authValue: '' };
    this.formError = '';
    this.showForm = true;
  }

  closeForm(): void {
    if (!this.saving) this.showForm = false;
  }

  saveCatalog(): void {
    if (!(this.editing ? this.canModify : this.canCreate)) return;
    this.saving = true;
    this.formError = '';
    const request: SaveCatalogRequest = {
      name: this.form.name.trim(),
      url: this.form.url.trim(),
      authHeader: this.form.authHeader?.trim() || null,
      authValue: this.form.authValue?.trim() || null,
    };
    const call = this.editing
      ? this.marketplace.updateCatalog(this.editing.catalogKey, request)
      : this.marketplace.addCatalog(request);

    call.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.saving = false;
          this.showForm = false;
          this.selectedCatalog = saved;      // open the saved marketplace and load it
          this.loadCatalogs();
        },
        error: (err) => {
          this.saving = false;
          this.formError = err?.error?.message ?? 'The marketplace could not be saved.';
          this.cdr.markForCheck();
        },
      });
  }

  removeCatalog(catalog: MarketplaceCatalog): void {
    if (!this.canModify) return;
    this.marketplace.removeCatalog(catalog.catalogKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { if (this.isOpen(catalog)) this.selectedCatalog = null; this.loadCatalogs(); },
        error: (err) => this.fail(err, 'The marketplace could not be removed.'),
      });
  }

  install(listing: MarketplaceListing): void {
    if (!(listing.isInstalled ? this.canModify : this.canCreate)) return;
    if (!this.selectedCatalog) return;
    this.busyPluginId = listing.plugin.id;
    this.error = '';
    this.marketplace.install(this.selectedCatalog.catalogKey, listing.plugin.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (visual) => {
          registerInstalledVisuals([visual]);   // usable without reloading the app
          this.busyPluginId = null;
          this.load();
        },
        error: (err) => { this.busyPluginId = null; this.fail(err, 'The plugin could not be installed.'); },
      });
  }

  uninstall(listing: MarketplaceListing): void {
    if (!this.canModify) return;
    if (!this.selectedCatalog) return;
    this.busyPluginId = listing.plugin.id;
    this.error = '';
    this.marketplace.uninstall(this.selectedCatalog.catalogKey, listing.plugin.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.busyPluginId = null; this.load(); },
        error: (err) => { this.busyPluginId = null; this.fail(err, 'The plugin could not be removed.'); },
      });
  }

  /** Uploads a .pbiviz package into the built-in marketplace and shows it. */
  importPbiviz(input: HTMLInputElement): void {
    if (!this.canCreate) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importing = true;
    this.error = '';
    this.marketplace.importPowerBiVisual(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.importing = false;
          const builtIn = this.catalogs.find(c => c.isBuiltIn);
          if (builtIn) { this.selectedCatalog = builtIn; this.load(); }
        },
        error: (err) => { this.importing = false; this.fail(err, 'The .pbiviz package could not be imported.'); },
      });
  }

  isPowerBiVisual(listing: MarketplaceListing): boolean {
    return listing.plugin.renderKind === 'pbiviz';
  }

  actionLabel(listing: MarketplaceListing): string {
    if (listing.updateAvailable) return 'Update';
    return listing.isInstalled ? 'Installed' : 'Install';
  }

  /** Renders the plugin's own template with sample data, so the card shows the real visual. */
  private previewOf(listing: MarketplaceListing): Record<string, any> | null {
    const { plugin } = listing;
    if (plugin.imageUrl || plugin.renderKind !== 'highcharts-template') return null;
    let options: Record<string, any> | null;
    try {
      options = isMultiRoleVisual(plugin.dataRoles)
        ? bindCustomVisualRows(plugin.optionsTemplateJson, plugin.dataRoles, {
          rows: PREVIEW_ROWS, columns: previewColumns(plugin.dataRoles),
          aggregate: values => values.reduce<number>((sum, value) => sum + (Number(value) || 0), 0),
        })
        : bindCustomVisualTemplate(plugin.optionsTemplateJson, plugin.dataRoles, PREVIEW_DATA);
    } catch {
      options = null;
    }
    if (!options) return null;
    return {
      ...options,
      chart: { ...options['chart'], height: 160, animation: false, spacing: [8, 8, 8, 8] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      tooltip: { enabled: false },
      accessibility: { enabled: false },
    };
  }

  private fail(err: any, fallback: string): void {
    this.error = err?.error?.message ?? (err?.status ? `${fallback} (HTTP ${err.status})` : fallback);
    this.cdr.markForCheck();
  }
}
