import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { SavedCatalogue, readAllCatalogues } from '../cataloguenew/cataloguenew.component';

@Component({
  selector: 'app-requestportal',
  templateUrl: './requestportal.component.html',
  styleUrls: ['./requestportal.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class RequestPortalComponent implements AfterViewInit {

  templates: SavedCatalogue[] = [];
  query = '';

  constructor(private router: Router) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.templates = readAllCatalogues();
  }

  /** Templates filtered by the live search query (matches name + description). */
  get filteredTemplates(): SavedCatalogue[] {
    const q = (this.query || '').trim().toLowerCase();
    if (!q) return this.templates;
    return this.templates.filter(t => {
      const name = (t.name || '').toLowerCase();
      const desc = (t.description || '').toLowerCase();
      return name.indexOf(q) !== -1 || desc.indexOf(q) !== -1;
    });
  }

  clearQuery(): void {
    this.query = '';
  }

  /** Open the form in fill-mode so the user can edit values and submit a request. */
  startRequest(t: SavedCatalogue): void {
    this.router.navigate(['/form-details'], {
      queryParams: { from: 'requestportal', id: t.id, mode: 'fill' }
    });
  }

  iconFor(name: string): string {
    const n = (name || '').toLowerCase();
    if (n.includes('site'))                                  return 'site';
    if (n.includes('crew'))                                  return 'crew';
    if (n.includes('incident'))                              return 'incident';
    if (n.includes('material'))                              return 'material';
    if (n.includes('ppe'))                                   return 'ppe';
    if (n.includes('permit') || n.includes('ptw'))           return 'permit';
    if (n.includes('lift'))                                  return 'lifting';
    if (n.includes('toolbox'))                               return 'toolbox';
    if (n.includes('engineering') || n.includes('moc') || n.includes('change')) return 'moc';
    if (n.includes('travel') || n.includes('logistics'))     return 'travel';
    return 'form';
  }

  trackById = (_: number, item: SavedCatalogue) => item.id;
}
