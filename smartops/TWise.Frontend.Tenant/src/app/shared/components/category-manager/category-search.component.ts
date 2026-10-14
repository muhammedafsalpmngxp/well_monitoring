import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-category-search, li[app-category-search]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <input type="search" placeholder="Search categories" aria-label="Search categories"
      [(ngModel)]="searchTerm" [ngModelOptions]="{ standalone: true }" (click)="$event.stopPropagation()"
      (keydown)="$event.stopPropagation()" />
    <div *ngIf="filteredOptions.length === 0" role="status">No categories found</div>
  `,
  styles: [`
    :host { display: block; padding: 8px; list-style: none; }
    input {
      display: block; box-sizing: border-box; width: 100%; min-width: 0; height: 36px;
      padding: 8px 10px; border: 1px solid #C9D3E2; border-radius: 8px;
      background: var(--color-bg-card, #fff); color: var(--color-text-primary, #101828);
      font-family: var(--font-family-base, inherit); font-size: 14px;
    }
    input:focus { outline: none; border-color: var(--color-primary, #21409A); }
    input::placeholder, [role=status] { color: #667085; }
    [role=status] { padding: 8px 2px; font-size: 14px; }
  `],
})
export class CategorySearchComponent<T> {
  @Input() options: readonly T[] = [];
  @Input() labelKey?: keyof T;
  searchTerm = '';

  get filteredOptions(): readonly T[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.options;
    return this.options.filter(option => this.matches(option));
  }

  matches(option: T): boolean {
    const label = this.labelKey ? option[this.labelKey] : option;
    return String(label ?? '').toLowerCase().includes(this.searchTerm.trim().toLowerCase());
  }
}