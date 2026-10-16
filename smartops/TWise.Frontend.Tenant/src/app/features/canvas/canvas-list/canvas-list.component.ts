import { ChangeDetectorRef, Component, OnDestroy, OnInit, Optional } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ROUTES } from '../../../core/constants/route.constants';
import { CategoryDropdown } from '../../../core/models/category.model';
import { DashboardSummaryResponse } from '../../../core/models/dashboard.model';
import { CategoryService } from '../../../core/services/category.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { PermissionService } from '../../../core/services/permission.service';
import { SCHEDULES_MODULE } from '../../../core/services/schedule.service';
import { apiErrorMessage } from '../../model-studio/model-studio.util';
import { CANVAS_MODULE, newCanvasConfig } from '../canvas-config.util';

/** WIP: my canvases (open, create, publish, delete). Standard: the published canvases (open). Without a mode, both. */
@Component({
  selector: 'app-canvas-list',
  standalone: false,
  templateUrl: './canvas-list.component.html',
  styleUrls: ['./canvas-list.component.scss'],
})
export class CanvasListComponent implements OnInit, OnDestroy {
  canvases: DashboardSummaryResponse[] = [];
  published: DashboardSummaryResponse[] = [];
  categories: CategoryDropdown[] = [];
  loading = true;
  error = '';
  toast: { kind: 'success' | 'error'; text: string } | null = null;

  createOpen = false;
  saving = false;
  form: { name: string; categoryId: number | null } = { name: '', categoryId: null };
  formError = '';

  pendingDelete: DashboardSummaryResponse | null = null;
  /** The canvas being published from its card. */
  publishingId: number | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly dashboards: DashboardService,
    private readonly categoryService: CategoryService,
    private readonly permissions: PermissionService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    @Optional() route?: ActivatedRoute | null,
  ) {
    this.mode = route?.snapshot.data['mode'] ?? null;
  }

  readonly mode: 'standard' | 'wip' | null;
  get showWip(): boolean { return this.mode !== 'standard'; }
  get showStandard(): boolean { return this.mode !== 'wip'; }

  get canCreate(): boolean { return this.permissions.canCreate(CANVAS_MODULE); }
  get canModify(): boolean { return this.permissions.canModify(CANVAS_MODULE); }
  get canSchedule(): boolean { return this.permissions.canCreate(SCHEDULES_MODULE); }

  /** The canvas the schedule dialog is open for. */
  scheduling: DashboardSummaryResponse | null = null;

  scheduleFor(canvas: DashboardSummaryResponse): void {
    this.scheduling = canvas;
  }

  get empty(): boolean { return !(this.showWip && this.canvases.length) && !(this.showStandard && this.published.length); }

  get deleteMessage(): string {
    return `Delete "${this.pendingDelete?.dashboardName ?? ''}"? Its sheets and objects will no longer be available to anyone.`;
  }

  ngOnInit(): void {
    this.dashboards.getMyCanvases().subscribe({
      next: groups => {
        this.canvases = groups.flatMap(group => group.dashboards);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.error = apiErrorMessage(err, 'Canvases could not be loaded.');
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
    this.dashboards.getPublishedCanvases().subscribe({
      next: groups => { this.published = groups.flatMap(group => group.dashboards); this.cdr.markForCheck(); },
      error: () => { this.published = []; this.cdr.markForCheck(); },
    });
    // Dashboard-typed categories only (GET /api/category?controlType=dashboard) — a canvas is stored as a
    // dashboard row, so a report/chart/tile category here would leave the new canvas out of every group
    // in GET /api/dashboard/wip?kind=canvas.
    this.categoryService.getCategoriesByType('dashboard').subscribe({
      next: categories => { this.categories = categories; this.cdr.markForCheck(); },
      error: () => { this.categories = []; this.cdr.markForCheck(); },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
  }

  open(canvas: DashboardSummaryResponse): void {
    this.router.navigate(['/', ROUTES.CANVAS, canvas.dashboardId]);
  }

  /** Publishes the canvas as it was last saved and moves it to Published (POST /api/dashboard/{id}/publish). */
  publish(canvas: DashboardSummaryResponse): void {
    if (this.publishingId !== null) return;
    this.publishingId = canvas.dashboardId;
    this.dashboards.publishDashboard(canvas.dashboardId).subscribe({
      next: response => {
        this.publishingId = null;
        this.canvases = this.canvases.filter(c => c.dashboardId !== canvas.dashboardId);
        this.published = [{ ...canvas, status: 'Published' }, ...this.published];
        this.showToast('success', response.data?.message || `"${canvas.dashboardName}" was published. It is now under Standard Canvases.`);
      },
      error: err => {
        this.publishingId = null;
        this.showToast('error', apiErrorMessage(err, 'The canvas could not be published.'));
      },
    });
  }

  openCreate(): void {
    this.form = { name: '', categoryId: this.categories.length === 1 ? this.categories[0].categoryId : null };
    this.formError = '';
    this.createOpen = true;
  }

  create(): void {
    const name = this.form.name.trim();
    if (!name || this.form.categoryId === null) {
      this.formError = 'Enter a name and choose a category.';
      return;
    }
    this.saving = true;
    this.dashboards.createDashboard({ dashboardName: name, categoryId: this.form.categoryId, configJson: newCanvasConfig() }).subscribe({
      next: response => {
        this.saving = false;
        this.createOpen = false;
        this.router.navigate(['/', ROUTES.CANVAS, response.data.dashboardId]);
      },
      error: err => {
        this.saving = false;
        this.formError = apiErrorMessage(err, 'The canvas could not be created.');
        this.cdr.markForCheck();
      },
    });
  }

  confirmDelete(): void {
    const canvas = this.pendingDelete;
    this.pendingDelete = null;
    if (!canvas) return;
    this.dashboards.deleteDashboard(canvas.dashboardId).subscribe({
      next: () => {
        this.canvases = this.canvases.filter(c => c.dashboardId !== canvas.dashboardId);
        this.showToast('success', `"${canvas.dashboardName}" was deleted.`);
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The canvas could not be deleted.')),
    });
  }

  private showToast(kind: 'success' | 'error', text: string): void {
    this.toast = { kind, text };
    this.cdr.markForCheck();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; this.cdr.markForCheck(); }, 4000);
  }
}
