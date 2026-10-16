import { Component, EventEmitter, Input, Output } from '@angular/core';

export type MultiSelectAccent = 'blue' | 'teal' | 'green' | 'purple';

export interface MultiSelectOption {
  id: string;
  label: string;
  accent?: MultiSelectAccent;
}

@Component({
  selector: 'app-multi-select',
  standalone: false,
  templateUrl: './multi-select.component.html',
  styleUrls: ['./multi-select.component.scss'],
})
export class MultiSelectComponent {
  @Input() label = '';
  @Input() required = false;
  @Input() placeholder = 'Search';
  @Input() options: MultiSelectOption[] = [];
  @Input() selectedIds: string[] = [];
  @Input() invalid = false;
  @Output() selectedIdsChange = new EventEmitter<string[]>();

  searchTerm = '';

  get selectedOptions(): MultiSelectOption[] {
    return this.options.filter(o => this.selectedIds.includes(o.id));
  }

  get filteredOptions(): MultiSelectOption[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.options;
    return this.options.filter(o => o.label.toLowerCase().includes(term));
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggleOption(id: string): void {
    const next = this.isSelected(id)
      ? this.selectedIds.filter(x => x !== id)
      : [...this.selectedIds, id];
    this.selectedIds = next;
    this.selectedIdsChange.emit(next);
  }

  removeChip(id: string): void {
    const next = this.selectedIds.filter(x => x !== id);
    this.selectedIds = next;
    this.selectedIdsChange.emit(next);
  }

  clearAll(): void {
    this.selectedIds = [];
    this.selectedIdsChange.emit([]);
  }
}
