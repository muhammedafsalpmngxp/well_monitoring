import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DictionaryColumn,
  DictionaryDataset,
  DictionaryDatasetDetail,
  GovernanceService,
  SENSITIVITIES,
} from '../../../core/services/governance.service';

/**
 * Data dictionary: every completed import and database view with its columns, and the business
 * documentation (name, description, owner, sensitivity, tags) the team adds to each of them.
 * Technical columns come from the dataset itself; only the documentation is stored.
 */
@Component({
  selector: 'app-data-dictionary',
  standalone: false,
  templateUrl: './data-dictionary.component.html',
  styleUrls: ['./data-dictionary.component.scss'],
})
export class DataDictionaryComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly sensitivities = SENSITIVITIES;

  datasets: DictionaryDataset[] = [];
  search = '';
  loading = false;
  error = '';

  selected: DictionaryDatasetDetail | null = null;
  /** Editable copy of the selected dataset's columns. */
  columns: DictionaryColumn[] = [];
  description = '';
  owner = '';
  columnSearch = '';
  loadingDetail = false;
  saving = false;
  saved = false;

  constructor(private readonly governance: GovernanceService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadDatasets();
  }

  get filteredDatasets(): DictionaryDataset[] {
    const q = this.search.trim().toLowerCase();
    return q ? this.datasets.filter(d => d.name.toLowerCase().includes(q)) : this.datasets;
  }

  get filteredColumns(): DictionaryColumn[] {
    const q = this.columnSearch.trim().toLowerCase();
    return q
      ? this.columns.filter(c => c.columnName.toLowerCase().includes(q) || (c.businessName ?? '').toLowerCase().includes(q))
      : this.columns;
  }

  get totalColumns(): number { return this.datasets.reduce((n, d) => n + d.columnCount, 0); }
  get documentedColumns(): number { return this.datasets.reduce((n, d) => n + d.documentedCount, 0); }
  get piiColumns(): number { return this.datasets.reduce((n, d) => n + d.piiCount, 0); }

  coverage(d: DictionaryDataset): number {
    return d.columnCount ? Math.round((d.documentedCount / d.columnCount) * 100) : 0;
  }

  isSelected(d: DictionaryDataset): boolean {
    return !!this.selected && this.selected.kind === d.kind && this.selected.id === d.id;
  }

  select(d: DictionaryDataset): void {
    if (this.isSelected(d)) return;
    this.loadingDetail = true;
    this.saved = false;
    this.governance.getDataset(d.kind, d.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: detail => {
        this.selected = detail;
        this.columns = detail.columns.map(c => ({ ...c }));
        this.description = detail.description ?? '';
        this.owner = detail.owner ?? '';
        this.columnSearch = '';
        this.loadingDetail = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not load the dataset.';
        this.loadingDetail = false;
        this.cdr.markForCheck();
      },
    });
  }

  save(): void {
    if (!this.selected || this.saving) return;
    this.saving = true;
    this.saved = false;
    const { kind, id } = this.selected;
    this.governance.saveDataset(kind, id, {
      description: this.description || null,
      owner: this.owner || null,
      columns: this.columns.map(({ dataType, ...rest }) => rest),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: detail => {
        this.selected = detail;
        this.columns = detail.columns.map(c => ({ ...c }));
        this.saving = false;
        this.saved = true;
        this.loadDatasets();
      },
      error: () => {
        this.error = 'Could not save the documentation.';
        this.saving = false;
        this.cdr.markForCheck();
      },
    });
  }

  private loadDatasets(): void {
    this.loading = true;
    this.error = '';
    this.governance.listDatasets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => {
        this.datasets = list;
        this.loading = false;
        if (!this.selected && list.length) this.select(list[0]);
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not load the datasets.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
