import { ChangeDetectorRef, Component, OnDestroy, OnInit, Optional } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ROUTES } from '../../../core/constants/route.constants';
import { CommonApiService, DbConnection } from '../../../core/services/common-api.service';
import { DatasetConnection, DatasetSummary, ModelStudioService } from '../../../core/services/model-studio.service';
import { PermissionService } from '../../../core/services/permission.service';
import { MODEL_STUDIO_MODULE, apiErrorMessage } from '../model-studio.util';

@Component({
  selector: 'app-dataset-list',
  standalone: false,
  templateUrl: './dataset-list.component.html',
  styleUrls: ['./dataset-list.component.scss'],
})
export class DatasetListComponent implements OnInit, OnDestroy {
  datasets: DatasetSummary[] = [];
  /** Every connection of the tenant, to name the connection of an existing dataset. */
  connections: DbConnection[] = [];
  /** The connections a new data model may use: active SQL Server connections of the tenant. */
  eligibleConnections: DatasetConnection[] = [];
  private eligibleLoaded = false;
  loading = true;
  error = '';
  toast: { kind: 'success' | 'error'; text: string } | null = null;

  createOpen = false;
  saving = false;
  form: { name: string; description: string; connectionId: number | null } = { name: '', description: '', connectionId: null };
  formError = '';

  pendingDelete: DatasetSummary | null = null;
  /** The dataset being published from its card. */
  publishingId: number | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly modelStudio: ModelStudioService,
    private readonly commonApi: CommonApiService,
    private readonly permissions: PermissionService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    @Optional() route?: ActivatedRoute | null,
  ) {
    this.mode = route?.snapshot.data['mode'] ?? null;
  }

  /** standard: published datasets. wip: datasets not published yet. null: all. */
  readonly mode: 'standard' | 'wip' | null;

  get shown(): DatasetSummary[] {
    if (!this.mode) return this.datasets;
    return this.datasets.filter(d => (d.status === 'published') === (this.mode === 'standard'));
  }

  get canCreate(): boolean { return this.permissions.canCreate(MODEL_STUDIO_MODULE); }
  get canModify(): boolean { return this.permissions.canModify(MODEL_STUDIO_MODULE); }

  get noEligibleConnection(): boolean { return this.eligibleLoaded && this.eligibleConnections.length === 0; }

  get deleteMessage(): string {
    return `Delete "${this.pendingDelete?.name ?? ''}"? Its tables, relationships and measures will no longer be available to anyone.`;
  }

  ngOnInit(): void {
    this.modelStudio.list().subscribe({
      next: datasets => { this.datasets = datasets; this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.error = apiErrorMessage(err, 'Data models could not be loaded.'); this.loading = false; this.cdr.markForCheck(); },
    });
    this.commonApi.getConnections().subscribe({
      next: connections => { this.connections = connections; this.cdr.markForCheck(); },
      error: () => { this.connections = []; },
    });
    this.modelStudio.connections().subscribe({
      next: eligible => {
        this.eligibleConnections = eligible;
        this.eligibleLoaded = true;
        if (this.createOpen && this.form.connectionId === null) this.form.connectionId = this.onlyEligibleId();
        this.cdr.markForCheck();
      },
      error: () => { this.eligibleConnections = []; },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
  }

  connectionName(id: number): string {
    return this.connections.find(c => c.id === id)?.connectionName ?? `Connection ${id}`;
  }

  open(dataset: DatasetSummary): void {
    this.router.navigate(['/', ROUTES.MODEL_STUDIO, dataset.id]);
  }

  /** Publishes the dataset's draft so canvases read it; a published dataset with no changes stays as it is. */
  publish(dataset: DatasetSummary): void {
    if (this.publishingId !== null) return;
    this.publishingId = dataset.id;
    this.modelStudio.publish(dataset.id).subscribe({
      next: detail => {
        this.publishingId = null;
        this.datasets = this.datasets.map(d => d.id === dataset.id ? { ...d, status: detail.status, publishedAt: detail.publishedAt } : d);
        this.showToast('success', `"${dataset.name}" was published. Canvases now read this version; it is listed under Standard Data Models.`);
      },
      error: err => {
        this.publishingId = null;
        this.showToast('error', apiErrorMessage(err, 'The data model could not be published.'));
      },
    });
  }

  openCreate(): void {
    this.form = { name: '', description: '', connectionId: this.onlyEligibleId() };
    this.formError = '';
    this.createOpen = true;
  }

  create(): void {
    const name = this.form.name.trim();
    if (!name || this.form.connectionId === null) {
      this.formError = 'Enter a name and choose a connection.';
      return;
    }
    this.saving = true;
    this.modelStudio.create({ name, description: this.form.description.trim() || null, connectionId: this.form.connectionId }).subscribe({
      next: created => {
        this.saving = false;
        this.createOpen = false;
        this.router.navigate(['/', ROUTES.MODEL_STUDIO, created.id]);
      },
      error: err => {
        this.saving = false;
        this.formError = apiErrorMessage(err, 'The data model could not be created.');
        this.cdr.markForCheck();
      },
    });
  }

  confirmDelete(): void {
    const dataset = this.pendingDelete;
    this.pendingDelete = null;
    if (!dataset) return;
    this.modelStudio.delete(dataset.id).subscribe({
      next: () => {
        this.datasets = this.datasets.filter(d => d.id !== dataset.id);
        this.showToast('success', `"${dataset.name}" was deleted.`);
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The data model could not be deleted.')),
    });
  }

  private onlyEligibleId(): number | null {
    return this.eligibleConnections.length === 1 ? this.eligibleConnections[0].id : null;
  }

  private showToast(kind: 'success' | 'error', text: string): void {
    this.toast = { kind, text };
    this.cdr.markForCheck();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; this.cdr.markForCheck(); }, 4000);
  }
}
