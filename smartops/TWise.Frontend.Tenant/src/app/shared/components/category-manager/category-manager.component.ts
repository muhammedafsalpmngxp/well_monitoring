import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';
import { ClientSideRowModelModule, ColDef, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { CategoryService } from '../../../core/services/category.service';
import { PermissionService } from '../../../core/services/permission.service';
import { CategoryDropdown, SaveCategoryRequest } from '../../../core/models/category.model';
import { CategoryNameCellRendererComponent } from './cell-renderers/category-name-cell-renderer.component';
import { CategoryDashboardCellRendererComponent } from './cell-renderers/category-dashboard-cell-renderer.component';
import { CategoryActionsCellRendererComponent } from './cell-renderers/category-actions-cell-renderer.component';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

@Component({
  selector: 'app-category-manager',
  standalone: false,
  templateUrl: './category-manager.component.html',
  styleUrls: ['./category-manager.component.scss'],
})
export class CategoryManagerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() controlType = '';
  @Output() closed = new EventEmitter<void>();

  private get permissionModule(): string {
    switch (this.controlType.toLowerCase()) {
      case 'dashboard': return 'dashboard.categories';
      case 'chart':
      case 'tile': return 'charts.categories';
      case 'report': return 'reports.categories';
      default: return '';
    }
  }

  get canView(): boolean { return !!this.permissionModule && this.permissions.canView(this.permissionModule); }
  get canCreate(): boolean { return this.canView && this.permissions.canCreate(this.permissionModule); }
  get canModify(): boolean { return this.canView && this.permissions.canModify(this.permissionModule); }
  get canSave(): boolean { return this.editingCategory ? this.canModify : this.canCreate; }

  categories: CategoryDropdown[] = [];
  isLoading = true;
  error = '';

  // AG Grid config
  readonly gridTheme = themeQuartz.withParams({
    accentColor: '#21409A',
    backgroundColor: '#ffffff',
    borderColor: '#E9EEF5',
    fontFamily: 'Inter, sans-serif',
    headerBackgroundColor: '#F9FAFB',
    headerTextColor: '#344054',
    headerFontWeight: 600,
    rowHoverColor: '#F5F8FF',
    wrapperBorder: false,
    wrapperBorderRadius: 0,
  });

  columnDefs: ColDef<CategoryDropdown>[] = [];

  private get itemCountColumnHeader(): string {
    switch (this.controlType.toLowerCase()) {
      case 'chart': return 'Charts';
      case 'tile': return 'Tiles';
      case 'report': return 'Reports';
      default: return 'Dashboards';
    }
  }

  readonly defaultColDef: ColDef<CategoryDropdown> = {
    sortable: true,
    resizable: false,
    suppressMovable: true,
    suppressHeaderMenuButton: true,
  };

  readonly gridContext = { componentParent: this };

  // Pagination — pure Angular, no GridApi needed
  readonly pageSize = 10;
  pgCurrentPage = 1;

  get filteredCategories(): CategoryDropdown[] {
    const all = this.searchQuery.trim()
      ? this.categories.filter(c => c.categoryName.toLowerCase().includes(this.searchQuery.toLowerCase()))
      : this.categories;
    // reset to page 1 when filter changes
    return all;
  }

  get pgTotalRows(): number { return this.filteredCategories.length; }
  get pgTotalPages(): number { return Math.max(1, Math.ceil(this.pgTotalRows / this.pageSize)); }
  get pgRangeStart(): number { return Math.min((this.pgCurrentPage - 1) * this.pageSize + 1, this.pgTotalRows); }
  get pgRangeEnd(): number { return Math.min(this.pgCurrentPage * this.pageSize, this.pgTotalRows); }

  // Cached (not a getter) so unrelated change detection (e.g. typing in the form) doesn't hand the grid a new array reference and force a re-render/blink.
  pagedCategories: CategoryDropdown[] = [];

  private updatePagedCategories(): void {
    const start = (this.pgCurrentPage - 1) * this.pageSize;
    this.pagedCategories = this.filteredCategories.slice(start, start + this.pageSize);
  }

  goToFirstPage(): void { this.pgCurrentPage = 1; this.updatePagedCategories(); }
  goToPrevPage(): void { this.pgCurrentPage = Math.max(1, this.pgCurrentPage - 1); this.updatePagedCategories(); }
  goToNextPage(): void { this.pgCurrentPage = Math.min(this.pgTotalPages, this.pgCurrentPage + 1); this.updatePagedCategories(); }
  goToLastPage(): void { this.pgCurrentPage = this.pgTotalPages; this.updatePagedCategories(); }

  onSearchChange(): void { this.pgCurrentPage = 1; this.updatePagedCategories(); }

  clearSearch(): void {
    this.searchQuery = '';
    this.onSearchChange();
  }

  // Add / Edit form
  showForm = false;
  editingCategory: CategoryDropdown | null = null;
  formName = '';
  formDescription = '';
  formError = '';
  isSaving = false;

  // Search
  searchQuery = '';

  // Success notification
  successMessage = '';
  private successTimeout: any;

  // Warning notification (e.g. blocked deletion)
  warningMessage = '';
  private warningTimeout: any;

  // Delete confirmation
  showDeleteConfirm = false;
  deletingCategory: CategoryDropdown | null = null;
  isDeleting = false;

  private sub!: Subscription;

  constructor(private readonly categoryService: CategoryService, private readonly cdr: ChangeDetectorRef,
    private readonly permissions: PermissionService) {}

  ngOnInit(): void {
    this.columnDefs = [
      {
        headerName: 'Category Name', field: 'categoryName', cellRenderer: CategoryNameCellRendererComponent,
        flex: 1, minWidth: 180, tooltip: params => params.data?.categoryName ?? '',
      },
      { headerName: this.itemCountColumnHeader, cellRenderer: CategoryDashboardCellRendererComponent, width: 150, sortable: false },
      { headerName: 'Actions', cellRenderer: CategoryActionsCellRendererComponent, width: 120, sortable: false, suppressHeaderMenuButton: true },
    ];

    this.loadCategories();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The modal is never destroyed/recreated between opens (only its inner *ngIf toggles), so
    // ngOnInit's one-time fetch goes stale the moment a dashboard/tile/chart is added or removed
    // elsewhere — refetch counts every time it's reopened instead of only at page load.
    if (changes['isOpen'] && this.isOpen && !changes['isOpen'].firstChange) {
      this.loadCategories();
    }
  }

  private loadCategories(): void {
    if (!this.canView) return;
    this.isLoading = true;
    this.error = '';
    this.sub?.unsubscribe();
    this.sub = this.categoryService.getManagedCategoriesByType(this.controlType).subscribe({
      next: (cats) => {
        this.categories = cats;
        this.updatePagedCategories();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load categories.';
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.successTimeout) clearTimeout(this.successTimeout);
    if (this.warningTimeout) clearTimeout(this.warningTimeout);
  }

  close(): void {
    this.clearForm();
    this.clearSearch();
    this.warningMessage = '';
    this.closed.emit();
  }

  // ─── Add / Edit ──────────────────────────────────────────────────────────────

  openAddForm(): void {
    if (!this.canCreate) return;
    this.editingCategory = null;
    this.formName = '';
    this.formDescription = '';
    this.formError = '';
    this.showForm = true;
  }

  openEditForm(cat: CategoryDropdown): void {
    if (!this.canModify) return;
    this.editingCategory = cat;
    this.formName = cat.categoryName;
    this.formDescription = cat.description ?? '';
    this.formError = '';
    this.showForm = true;
    // AG Grid's cell renderers run outside Angular's zone, so force a sync render now
    // instead of waiting for an unrelated event to flush the change on the next click.
    this.cdr.detectChanges();
  }

  cancelForm(): void {
    this.showForm = false;
    this.editingCategory = null;
  }

  clearForm(): void {
    this.formName = '';
    this.formDescription = '';
    this.formError = '';
    this.editingCategory = null;
    this.showForm = false;
  }

  saveCategory(): void {
    if (!this.canSave) return;
    const name = this.formName.trim();
    if (!name) {
      this.formError = 'Category Name Is Required.';
      return;
    }

    const description = this.formDescription.trim();
    if (!description) {
      this.formError = 'Description Is Required.';
      return;
    }

    this.isSaving = true;
    this.formError = '';

    const request: SaveCategoryRequest = {
      categoryName: name,
      description: description,
      controlType: this.controlType,
    };

    const isEdit = !!this.editingCategory;
    const obs$ = isEdit
      ? this.categoryService.updateCategory(this.editingCategory!.categoryId, request)
      : this.categoryService.createCategory(request);

    obs$.subscribe({
      next: (response) => {
        this.isSaving = false;
        this.showForm = false;
        this.editingCategory = null;
        this.formName = '';
        this.formDescription = '';
        const action = isEdit ? 'updated' : 'created';
        const savedName = response?.data?.categoryName || name;
        this.showSuccess(`'${savedName}' ${action} successfully.`);
        this.reloadCategories();
      },
      error: (err) => {
        this.formError = err?.error?.message || err?.message || 'Failed to save category.';
        this.isSaving = false;
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  confirmDelete(cat: CategoryDropdown): void {
    if (!this.canModify) return;
    // A category can only be removed once it's empty. Block it up-front (and show a clear
    // message) when the Manage list already knows it still holds items — the backend enforces
    // the same rule authoritatively, including published/standard reports the list can't see.
    const itemCount = cat.itemCount ?? 0;
    if (itemCount > 0) {
      this.showWarning(`Cannot delete '${cat.categoryName}'. It still has ${this.itemNoun(itemCount)}. Move or delete them first.`);
      return;
    }
    this.deletingCategory = cat;
    this.showDeleteConfirm = true;
  }

  private itemNoun(count: number): string {
    const nouns: Record<string, string> = { chart: 'chart', tile: 'tile', report: 'report', dashboard: 'dashboard' };
    const noun = nouns[this.controlType.toLowerCase()] ?? 'item';
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.deletingCategory = null;
  }

  deleteCategory(): void {
    if (!this.canModify || !this.deletingCategory) return;
    this.isDeleting = true;
    const catName = this.deletingCategory.categoryName;

    this.categoryService.deleteCategory(this.deletingCategory.categoryId).subscribe({
      next: () => {
        this.isDeleting = false;
        this.showDeleteConfirm = false;
        this.deletingCategory = null;
        this.showSuccess(`'${catName}' deleted successfully.`);
        this.reloadCategories();
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to delete category.';
        this.isDeleting = false;
        this.showDeleteConfirm = false;
        this.cdr.markForCheck();
      },
    });
  }

  private reloadCategories(): void {
    this.categoryService.getManagedCategoriesByType(this.controlType).subscribe({
      next: (cats) => { this.categories = cats; this.updatePagedCategories(); this.cdr.markForCheck(); },
      error: () => {},
    });
  }

  // ─── Success Notification ────────────────────────────────────────────────────

  private showSuccess(message: string): void {
    this.successMessage = message;
    if (this.successTimeout) clearTimeout(this.successTimeout);
    this.successTimeout = setTimeout(() => {
      this.successMessage = '';
    }, 4000);
  }

  private showWarning(message: string): void {
    this.warningMessage = message;
    this.cdr.markForCheck();
    if (this.warningTimeout) clearTimeout(this.warningTimeout);
    this.warningTimeout = setTimeout(() => {
      this.warningMessage = '';
      this.cdr.markForCheck();
    }, 5000);
  }
}
