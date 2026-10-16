import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

export interface SavedCatalogue {
  id: string;
  name: string;
  description: string;
  fields: any[];
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

export const CATALOGUE_NEW_STORAGE_KEY = 'altasnim.catalogue.forms';

/**
 * Default catalogues seeded on first ever load so the listing page is never
 * empty for a brand-new user. These represent realistic forms built from
 * the 10 builder components (Single Line, Heading, Checkbox, Single Choice,
 * Upload File, Dropdown, Image, Paragraph, Section, Button).
 */
const DEFAULT_CATALOGUES: SavedCatalogue[] = [
  {
    id: 'cat-seed-site-inspection',
    name: 'Site Inspection',
    description: 'Daily walk-through capture for HSE & quality leads',
    fields: [
      { id: 1,  type: 'heading',       label: 'Site Information',       width: 'full' },
      { id: 2,  type: 'single-line',   label: 'Inspector Name',         width: 'half' },
      { id: 3,  type: 'dropdown',      label: 'Cluster',                width: 'half', options: ['NIMR', 'AL BURJ', 'AMIN', 'TUQAA', 'RAKID'] },
      { id: 4,  type: 'single-choice', label: 'Site Status',            width: 'full', options: ['Operational', 'Restricted', 'Shut down'] },
      { id: 5,  type: 'checkbox',      label: 'PPE Compliance Checks',  width: 'full', options: ['Helmet', 'Vest', 'Gloves', 'Eye protection'] },
      { id: 6,  type: 'paragraph',     label: 'Observations',           width: 'full' },
      { id: 7,  type: 'upload-file',   label: 'Upload site photos',     width: 'full' },
      { id: 8,  type: 'section',       label: 'Sign-off',               width: 'full' },
      { id: 9,  type: 'image',         label: 'Inspector signature',    width: 'half' },
      { id: 10, type: 'button',        label: 'Submit',                 width: 'full' }
    ],
    fieldCount: 10,
    createdAt: '2026-04-24T08:00:00.000Z',
    updatedAt: '2026-04-28T14:30:00.000Z'
  },
  {
    id: 'cat-seed-crew-daily',
    name: 'Crew Daily Report',
    description: 'End-of-shift productivity & blockers from supervisors',
    fields: [
      { id: 1, type: 'heading',     label: 'Crew Details',           width: 'full' },
      { id: 2, type: 'single-line', label: 'Crew ID',                width: 'half' },
      { id: 3, type: 'dropdown',    label: 'Discipline',             width: 'half', options: ['Mechanical', 'Civil', 'Electrical', 'Instrument'] },
      { id: 4, type: 'single-line', label: 'Hours worked',           width: 'half' },
      { id: 5, type: 'paragraph',   label: 'Activities completed',   width: 'full' },
      { id: 6, type: 'upload-file', label: 'Attach daily log',       width: 'full' },
      { id: 7, type: 'button',      label: 'Submit Report',          width: 'full' }
    ],
    fieldCount: 7,
    createdAt: '2026-04-22T07:30:00.000Z',
    updatedAt: '2026-04-29T18:10:00.000Z'
  },
  {
    id: 'cat-seed-material-request',
    name: 'Material Request',
    description: 'Procurement intake from field for missing items',
    fields: [
      { id: 1, type: 'single-line',   label: 'Requester Name',     width: 'half' },
      { id: 2, type: 'single-line',   label: 'Well ID',            width: 'half' },
      { id: 3, type: 'dropdown',      label: 'Item Category',      width: 'full', options: ['Pipe', 'Cable', 'PPE', 'Tools', 'Consumables'] },
      { id: 4, type: 'single-line',   label: 'Quantity',           width: 'half' },
      { id: 5, type: 'single-choice', label: 'Urgency',            width: 'half', options: ['Standard', 'Expedited', 'Emergency'] },
      { id: 6, type: 'paragraph',     label: 'Justification',      width: 'full' },
      { id: 7, type: 'button',        label: 'Submit Request',     width: 'full' }
    ],
    fieldCount: 7,
    createdAt: '2026-04-20T11:15:00.000Z',
    updatedAt: '2026-04-25T09:45:00.000Z'
  },
  {
    id: 'cat-seed-permit-to-work',
    name: 'Permit to Work',
    description: 'High-risk job authorization — PTW with hazards, controls and approvals',
    fields: [
      { id: 1,  type: 'single-line',  label: 'Permit Number',    width: 'half', required: true, placeholder: 'PTW-2026-0001' },
      { id: 2,  type: 'single-line',  label: 'Issue Date',       width: 'half', required: true, placeholder: 'DD/MM/YYYY' },
      { id: 3,  type: 'dropdown',     label: 'Work Type',        width: 'half', required: true, options: ['Hot Work', 'Cold Work', 'Confined Space', 'Excavation', 'Working at Height', 'Electrical', 'Other'] },
      { id: 4,  type: 'single-line',  label: 'Location / Well ID', width: 'half', required: true },
      { id: 5,  type: 'paragraph',    label: 'Work Description', width: 'full', required: true, placeholder: 'Scope, equipment involved, duration' },
      { id: 6,  type: 'checkbox',     label: 'Hazards Identified', width: 'full', required: true, options: ['Falling objects', 'Hot surfaces', 'Toxic gases', 'Live electrical', 'Pressurized systems', 'Confined space'] },
      { id: 7,  type: 'single-line',  label: 'Permit Holder',    width: 'half', required: true },
      { id: 8,  type: 'single-line',  label: 'Authorized By',    width: 'half', required: true },
      { id: 9,  type: 'single-line',  label: 'Valid Until',      width: 'half', required: true, placeholder: 'DD/MM/YYYY HH:mm' },
      { id: 10, type: 'upload-file',  label: 'JSA / Method Statement', width: 'full', placeholder: 'jsa-ptw-2026-0001.pdf' },
      { id: 11, type: 'button',       label: 'Submit Permit',    width: 'full' }
    ],
    fieldCount: 11,
    createdAt: '2026-04-26T07:00:00.000Z',
    updatedAt: '2026-04-26T07:00:00.000Z'
  },
  {
    id: 'cat-seed-lifting-plan',
    name: 'Lifting Plan',
    description: 'Crane lift planning with load weight, radius, risk category and sign-offs',
    fields: [
      { id: 1, type: 'single-line',   label: 'Lift Reference',   width: 'half', required: true, placeholder: 'LP-2026-0042' },
      { id: 2, type: 'single-line',   label: 'Lift Date',        width: 'half', required: true, placeholder: 'DD/MM/YYYY' },
      { id: 3, type: 'dropdown',      label: 'Crane / Equipment', width: 'half', required: true, options: ['50T Mobile Crane', '100T Crawler Crane', '250T Crawler Crane', 'Telehandler', 'Tower Crane', 'Other'] },
      { id: 4, type: 'numbers',       label: 'Load Weight (kg)', width: 'half', required: true },
      { id: 5, type: 'numbers',       label: 'Lift Radius (m)',  width: 'half' },
      { id: 6, type: 'numbers',       label: 'Boom Length (m)',  width: 'half' },
      { id: 7, type: 'single-choice', label: 'Risk Category',    width: 'full', required: true, options: ['Critical', 'Complex', 'Routine'] },
      { id: 8, type: 'single-line',   label: 'Lift Supervisor',  width: 'half', required: true },
      { id: 9, type: 'single-line',   label: 'Banksman / Rigger', width: 'half', required: true },
      { id: 10, type: 'upload-file',  label: 'Lift Plan Document', width: 'full', placeholder: 'lift-plan-LP-2026-0042.pdf' },
      { id: 11, type: 'button',       label: 'Submit for Approval', width: 'full' }
    ],
    fieldCount: 11,
    createdAt: '2026-04-26T08:30:00.000Z',
    updatedAt: '2026-04-26T08:30:00.000Z'
  },
  {
    id: 'cat-seed-toolbox-talk',
    name: 'Toolbox Talk',
    description: 'Daily safety briefing record — topic, attendees and concerns raised',
    fields: [
      { id: 1, type: 'single-line',  label: 'Talk Date',        width: 'half', required: true, placeholder: 'DD/MM/YYYY' },
      { id: 2, type: 'single-line',  label: 'Crew ID',          width: 'half', required: true, placeholder: 'e.g. CW-001' },
      { id: 3, type: 'dropdown',     label: 'Topic',            width: 'half', required: true, options: ['PPE', 'Working at Height', 'Manual Handling', 'Permit to Work', 'Hot Work', 'Confined Space', 'Driving Safety', 'Hand Tools', 'Energy Isolation'] },
      { id: 4, type: 'single-line',  label: 'Conducted By',     width: 'half', required: true },
      { id: 5, type: 'numbers',      label: 'Number of Attendees', width: 'half', required: true },
      { id: 6, type: 'paragraph',    label: 'Key Points Discussed', width: 'full', required: true, placeholder: 'Hazards, controls, lessons from recent incidents' },
      { id: 7, type: 'paragraph',    label: 'Concerns / Q&A',   width: 'full', placeholder: 'Anything raised by the crew that needs follow-up' },
      { id: 8, type: 'upload-file',  label: 'Sign-in Sheet',    width: 'full', placeholder: 'toolbox-2026-04-26-CW001.jpg' },
      { id: 9, type: 'button',       label: 'Submit Record',    width: 'full' }
    ],
    fieldCount: 9,
    createdAt: '2026-04-25T07:30:00.000Z',
    updatedAt: '2026-04-26T07:30:00.000Z'
  },
  {
    id: 'cat-seed-engineering-change',
    name: 'Engineering Change Request',
    description: 'MOC for permanent or temporary changes — discipline, risk and impact assessment',
    fields: [
      { id: 1,  type: 'single-line',   label: 'MOC Reference',     width: 'half', required: true, placeholder: 'MOC-2026-0017' },
      { id: 2,  type: 'single-line',   label: 'Date Raised',       width: 'half', required: true, placeholder: 'DD/MM/YYYY' },
      { id: 3,  type: 'single-line',   label: 'Originator',        width: 'half', required: true },
      { id: 4,  type: 'dropdown',      label: 'Discipline',        width: 'half', required: true, options: ['Mechanical', 'Civil', 'Electrical', 'Instrument', 'Process', 'Pipeline'] },
      { id: 5,  type: 'single-choice', label: 'Change Type',       width: 'full', required: true, options: ['Permanent', 'Temporary', 'Emergency'] },
      { id: 6,  type: 'single-line',   label: 'Asset / Well / System', width: 'full', required: true },
      { id: 7,  type: 'single-line',   label: 'Change Title',      width: 'full', required: true },
      { id: 8,  type: 'paragraph',     label: 'Reason for Change', width: 'full', required: true, placeholder: 'Driver, regulatory or operational' },
      { id: 9,  type: 'single-choice', label: 'Risk Level',        width: 'half', required: true, options: ['Low', 'Medium', 'High', 'Critical'] },
      { id: 10, type: 'numbers',       label: 'Estimated Cost (OMR)', width: 'half' },
      { id: 11, type: 'numbers',       label: 'Schedule Impact (days)', width: 'half' },
      { id: 12, type: 'upload-file',   label: 'Drawings / References', width: 'full' },
      { id: 13, type: 'button',        label: 'Submit MOC',        width: 'full' }
    ],
    fieldCount: 13,
    createdAt: '2026-04-24T09:00:00.000Z',
    updatedAt: '2026-04-27T16:20:00.000Z'
  },
  {
    id: 'cat-seed-travel-logistics',
    name: 'Travel & Logistics Request',
    description: 'Crew movement, vehicle booking and material transport between sites',
    fields: [
      { id: 1, type: 'single-line', label: 'Trip Reference',       width: 'half', required: true, placeholder: 'TLR-2026-0089' },
      { id: 2, type: 'single-line', label: 'Travel Date',          width: 'half', required: true, placeholder: 'DD/MM/YYYY' },
      { id: 3, type: 'single-line', label: 'Requester',            width: 'half', required: true },
      { id: 4, type: 'dropdown',    label: 'Trip Type',            width: 'half', required: true, options: ['Crew Movement', 'Material Delivery', 'Equipment Transport', 'VIP / Visitor'] },
      { id: 5, type: 'single-line', label: 'Origin',               width: 'half', required: true, placeholder: 'Base camp / Pad #' },
      { id: 6, type: 'single-line', label: 'Destination',          width: 'half', required: true, placeholder: 'Well / Pad #' },
      { id: 7, type: 'numbers',     label: 'Number of Passengers', width: 'half' },
      { id: 8, type: 'dropdown',    label: 'Vehicle Type',         width: 'half', required: true, options: ['4x4 Pickup', '4x4 SUV', '24-Seater Bus', '50-Seater Crew Bus', 'Heavy Truck', 'Lowbed Trailer'] },
      { id: 9, type: 'paragraph',   label: 'Special Requirements', width: 'full', placeholder: 'PPE, escort, security clearance, refreshments' },
      { id: 10, type: 'button',     label: 'Submit Request',       width: 'full' }
    ],
    fieldCount: 10,
    createdAt: '2026-04-23T13:45:00.000Z',
    updatedAt: '2026-04-26T11:10:00.000Z'
  }
];

/** Bump whenever DEFAULT_CATALOGUES gains new entries so existing
 *  localStorage installs get the new templates added on next read. */
const SEED_SCHEMA_VERSION = 2;
const SEED_VERSION_KEY = 'altasnim.catalogue.schema.version';

export function readAllCatalogues(): SavedCatalogue[] {
  let stored: SavedCatalogue[] = [];
  try {
    const raw = localStorage.getItem(CATALOGUE_NEW_STORAGE_KEY);
    if (raw === null) {
      // First-ever load — seed the full default set and stamp the schema version.
      writeAllCatalogues(DEFAULT_CATALOGUES);
      try { localStorage.setItem(SEED_VERSION_KEY, String(SEED_SCHEMA_VERSION)); } catch {}
      return DEFAULT_CATALOGUES.slice();
    }
    const arr = JSON.parse(raw);
    stored = Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }

  // Migration — pull in any default templates the user hasn't seen yet
  // (added in a newer schema version) without disturbing user-created entries.
  let storedVersion = 0;
  try {
    const v = localStorage.getItem(SEED_VERSION_KEY);
    storedVersion = v ? parseInt(v, 10) : 0;
  } catch {}

  if (storedVersion < SEED_SCHEMA_VERSION) {
    const knownIds = new Set(stored.map(s => s.id));
    const newDefaults = DEFAULT_CATALOGUES.filter(d => !knownIds.has(d.id));
    if (newDefaults.length > 0) {
      stored = stored.concat(newDefaults);
      writeAllCatalogues(stored);
    }
    try { localStorage.setItem(SEED_VERSION_KEY, String(SEED_SCHEMA_VERSION)); } catch {}
  }
  return stored;
}

export function writeAllCatalogues(items: SavedCatalogue[]): void {
  try {
    localStorage.setItem(CATALOGUE_NEW_STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('[cataloguenew] persist failed', e);
  }
}

export function upsertCatalogue(item: SavedCatalogue): void {
  const items = readAllCatalogues();
  const idx = items.findIndex(x => x.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  writeAllCatalogues(items);
}

export function findCatalogue(id: string): SavedCatalogue | null {
  return readAllCatalogues().find(x => x.id === id) || null;
}

export function deleteCatalogue(id: string): void {
  writeAllCatalogues(readAllCatalogues().filter(x => x.id !== id));
}

@Component({
  selector: 'app-cataloguenew',
  templateUrl: './cataloguenew.component.html',
  styleUrls: ['./cataloguenew.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CatalogueNewComponent implements AfterViewInit, OnDestroy {

  items: SavedCatalogue[] = [];

  constructor(private router: Router) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.refresh();
  }

  ngOnDestroy(): void {}

  refresh(): void {
    this.items = readAllCatalogues();
  }

  onNew(): void {
    this.router.navigate(['/form-details'], { queryParams: { from: 'cataloguenew' } });
  }

  onView(item: SavedCatalogue): void {
    this.router.navigate(['/form-details'], {
      queryParams: { from: 'cataloguenew', id: item.id, mode: 'view' }
    });
  }

  onEdit(item: SavedCatalogue): void {
    this.router.navigate(['/form-details'], {
      queryParams: { from: 'cataloguenew', id: item.id }
    });
  }

  onDelete(item: SavedCatalogue): void {
    if (!confirm(`Delete catalogue "${item.name}"?`)) return;
    deleteCatalogue(item.id);
    this.refresh();
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch {
      return iso;
    }
  }

  trackById = (_: number, item: SavedCatalogue) => item.id;
}
