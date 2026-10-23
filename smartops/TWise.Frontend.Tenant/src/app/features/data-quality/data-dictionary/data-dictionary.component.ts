import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DictionaryColumn,
  DictionaryDataset,
  DictionaryDatasetDetail,
  DictionaryDraft,
  GovernanceService,
  SENSITIVITIES,
} from '../../../core/services/governance.service';
import { AiService } from '../../../core/services/ai.service';

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
  private readonly ai = inject(AiService);
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

  /** Draft the data dictionary AI feature is on for the user's role. */
  canDraft = false;
  drafting = false;
  draftNote = '';
  /** Columns the AI filled in, highlighted until the user saves (or opens another dataset). */
  aiDrafted = new Set<string>();

  constructor(private readonly governance: GovernanceService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadDatasets();
    this.ai.features().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: f => { this.canDraft = f.enabled.includes('dictionary'); this.cdr.markForCheck(); },
      error: () => { /* the button stays hidden */ },
    });
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
    this.clearDraft();
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

  /** Asks the AI for a draft and fills only the empty fields; nothing is saved until the user clicks Save. */
  draft(): void {
    if (!this.selected || this.drafting) return;
    this.drafting = true;
    this.draftNote = '';
    const { kind, id } = this.selected;
    this.governance.draftDataset(kind, id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => { this.applyDraft(d); this.drafting = false; this.cdr.markForCheck(); },
      error: err => {
        this.drafting = false;
        this.draftNote = err?.error?.message ?? 'The AI could not draft this dataset. Try again.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Written documentation is kept: the draft goes into empty fields only, and a column's sensitivity only while it is undocumented. */
  private applyDraft(d: DictionaryDraft): void {
    this.saved = false;
    if (!this.description.trim() && d.description) this.description = d.description;
    for (const draft of d.columns) {
      const c = this.columns.find(x => x.columnName === draft.columnName);
      if (!c) continue;
      const undocumented = !c.businessName?.trim() && !c.description?.trim();
      let filled = false;
      if (!c.businessName?.trim() && draft.businessName) { c.businessName = draft.businessName; filled = true; }
      if (!c.description?.trim() && draft.description) { c.description = draft.description; filled = true; }
      if (!c.tags?.trim() && draft.tags) { c.tags = draft.tags; filled = true; }
      if (undocumented && draft.sensitivity !== c.sensitivity) { c.sensitivity = draft.sensitivity; filled = true; }
      if (filled) this.aiDrafted.add(c.columnName);
    }
    this.draftNote = this.aiDrafted.size
      ? `The AI filled ${this.aiDrafted.size} column${this.aiDrafted.size === 1 ? '' : 's'} (highlighted). Review and edit them, then Save.`
      : 'Every column is already documented; nothing was changed.';
  }

  private clearDraft(): void {
    this.aiDrafted = new Set();
    this.draftNote = '';
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
        this.clearDraft();
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
