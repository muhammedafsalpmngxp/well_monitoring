import { Component, AfterViewInit, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
  SavedCatalogue,
  findCatalogue,
  upsertCatalogue
} from '../cataloguenew/cataloguenew.component';

export interface ComponentTile {
  id: string;
  label: string;
  color: 'blue' | 'red' | 'green' | 'orange' | 'yellow' | 'purple' | 'pink' | 'slate';
  iconKey: string;
}

export interface ComponentCategory {
  id: string;
  title: string;
  tiles: ComponentTile[];
  premium?: boolean;
  collapsed?: boolean;
}

export type PaletteTab = 'components' | 'layout' | 'theme';

export type CanvasFieldType =
  | 'name' | 'numbers' | 'email' | 'address'
  | 'single-line' | 'heading' | 'checkbox' | 'single-choice'
  | 'upload-file' | 'dropdown' | 'image' | 'paragraph'
  | 'section' | 'button' | 'phone' | 'toggle';

export interface CanvasField {
  id: number;
  type: CanvasFieldType;
  label: string;
  placeholder?: string;
  width: 'full' | 'half' | 'third';
  options?: string[];
  value?: any;
  required?: boolean;
}

@Component({
  selector: 'app-form-details',
  templateUrl: './form-details.component.html',
  styleUrls: ['./form-details.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class FormDetailsComponent implements OnInit, AfterViewInit, OnDestroy {

  formTitle = '';
  formDescription = '';

  paletteSearch = '';
  activeTab: PaletteTab = 'components';

  categories: ComponentCategory[] = [
    {
      id: 'custom',
      title: 'FORM_DETAILS.CAT_CUSTOM',
      tiles: [
        { id: 'single-line',   label: 'FORM_DETAILS.TILE_SINGLE_LINE',   color: 'orange', iconKey: 'tletter' },
        { id: 'heading',       label: 'FORM_DETAILS.TILE_HEADING',       color: 'blue',   iconKey: 'hletter' },
        { id: 'checkbox',      label: 'FORM_DETAILS.TILE_CHECKBOX',      color: 'yellow', iconKey: 'check' },
        { id: 'single-choice', label: 'FORM_DETAILS.TILE_SINGLE_CHOICE', color: 'blue',   iconKey: 'radio' },
        { id: 'upload-file',   label: 'FORM_DETAILS.TILE_UPLOAD_FILE',   color: 'blue',   iconKey: 'upload' },
        { id: 'dropdown',      label: 'FORM_DETAILS.TILE_DROPDOWN',      color: 'red',    iconKey: 'chevron' },
        { id: 'image',         label: 'FORM_DETAILS.TILE_IMAGE',         color: 'slate',  iconKey: 'image' },
        { id: 'paragraph',     label: 'FORM_DETAILS.TILE_PARAGRAPH',     color: 'pink',   iconKey: 'paragraph' },
        { id: 'section',       label: 'FORM_DETAILS.TILE_SECTION',       color: 'slate',  iconKey: 'section' },
        { id: 'button',        label: 'FORM_DETAILS.TILE_BUTTON',        color: 'slate',  iconKey: 'button' }
      ]
    },
    {
      id: 'premium',
      title: 'FORM_DETAILS.CAT_PREMIUM',
      premium: true,
      tiles: []
    }
  ];

  canvasFields: CanvasField[] = [];

  selectedFieldId: number | null = null;
  private nextFieldId = 100;

  /** Where the user opened this builder from — controls back/save navigation. */
  private originRoute: 'forms' | 'cataloguenew' | 'requestportal' = 'forms';
  /** Existing catalogue ID when editing (else fresh form). */
  private editingId: string | null = null;
  /** True when the page is in fill-mode (from Request Portal): hides the
   *  builder palette, makes inputs editable, and routes save to My Requests
   *  as a submitted request instead of upserting the catalogue template. */
  fillMode = false;

  // ── Forms AI Agent ──────────────────────────────────────
  aiModalOpen = false;
  aiPrompt = '';
  aiBusy = false;
  aiTrace: { kind: 'thinking' | 'tool' | 'ok'; msg: string }[] = [];
  aiSuggestions: { id: string; label: string; title: string; prompt: string }[] = [
    {
      id: 'site-inspection',
      label: 'Site Inspection',
      title: 'Site Inspection Report',
      prompt: 'Site inspection form with inspector name, date of inspection, cluster, well ID, location, site status (operational, restricted, shut down), PPE compliance checklist (helmet, vest, gloves, eye protection), observations paragraph, photo upload and inspector signature'
    },
    {
      id: 'crew-daily',
      label: 'Crew Daily Report',
      title: 'Crew Daily Report',
      prompt: 'Crew daily report form with supervisor name, date, crew ID, discipline, well ID, hours worked, activities completed paragraph, issues / blockers and daily log file attachment'
    },
    {
      id: 'incident-report',
      label: 'Incident Report',
      title: 'Incident Report',
      prompt: 'Incident report form with reporter name, date and time, well ID, location, incident type, severity (low, medium, high, critical), incident description paragraph, root cause notes, witness names, photo upload and signature'
    },
    {
      id: 'material-request',
      label: 'Material Request',
      title: 'Material Request',
      prompt: 'Material request form with requester name, request date, well ID, discipline, item category dropdown (pipe, cable, equipment, tools, consumables), item description, quantity, unit, urgency (standard, expedited, emergency), required-by date, AFE / budget code, justification paragraph and supporting document attachment'
    },
    {
      id: 'ppe-audit',
      label: 'PPE Audit',
      title: 'PPE Compliance Audit',
      prompt: 'PPE compliance audit form with auditor name, date, crew ID, location, PPE checklist (helmet, safety vest, gloves, eye protection, safety boots, hearing protection), compliance score, violations found, corrective actions, photo evidence and auditor signature'
    }
  ];

  /** Tracks which chip was last clicked, so Generate can use the full template. */
  private selectedTemplateId: string | null = null;
  /** The prompt that was last set by a chip — used to detect user edits. */
  private lastChipPrompt = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const from = qp.get('from');
    this.originRoute = from === 'cataloguenew' ? 'cataloguenew'
                     : from === 'requestportal' ? 'requestportal'
                     : 'forms';
    this.editingId = qp.get('id');
    this.fillMode = qp.get('mode') === 'fill';

    // If editing an existing saved catalogue, hydrate from storage.
    if (this.editingId) {
      const saved = findCatalogue(this.editingId);
      if (saved) {
        this.formTitle = saved.name;
        this.formDescription = saved.description;
        this.canvasFields = (saved.fields || []) as CanvasField[];
        const maxId = this.canvasFields.reduce((m, f) => Math.max(m, f.id || 0), 0);
        this.nextFieldId = Math.max(this.nextFieldId, maxId + 1);
        return;
      }
    }

    // Fresh form — start with a blank canvas. The user describes the form
    // in the Forms AI Agent modal and the canvas is populated on Generate.
    // Empty title/description placeholders show in the header inputs, and
    // the empty-canvas hint guides the user to add fields manually or via AI.
    this.formTitle = '';
    this.formDescription = '';
    this.canvasFields = [];
    this.nextFieldId = 200;
  }

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
  }

  ngOnDestroy(): void {}

  onBack(): void {
    this.router.navigate(['/' + this.originRoute]);
  }

  onSave(): void {
    if (this.fillMode) {
      this.submitRequest();
      return;
    }
    // Both Catalogue pages (/forms and /cataloguenew) share the same localStorage
    // library, so always persist regardless of which page launched the builder.
    const now = new Date().toISOString();
    const existing = this.editingId ? findCatalogue(this.editingId) : null;
    const record: SavedCatalogue = {
      id: existing?.id || this.editingId || this.generateId(),
      name: (this.formTitle || '').trim() || 'Untitled Catalogue',
      description: (this.formDescription || '').trim(),
      fields: this.canvasFields,
      fieldCount: this.canvasFields.length,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    upsertCatalogue(record);
    this.router.navigate(['/' + this.originRoute]);
  }

  /** Fill-mode submission: capture the field values as a new request entry
   *  in the My Requests store, then route there. */
  private submitRequest(): void {
    const REQUESTS_KEY = 'altasnim.requests';
    let existing: any[] = [];
    try {
      const raw = localStorage.getItem(REQUESTS_KEY);
      existing = raw ? (JSON.parse(raw) || []) : [];
      if (!Array.isArray(existing)) existing = [];
    } catch { existing = []; }

    const reference = this.generateRequestRef(this.formTitle);
    const submission = {
      id: 'req-' + Date.now().toString(36),
      formId: this.editingId || '',
      formName: (this.formTitle || '').trim() || 'Untitled Request',
      submittedBy: this.deriveSubmitter(),
      submittedAt: new Date().toISOString(),
      status: 'Pending' as const,
      reference,
      fields: this.canvasFields.map(f => ({
        id: f.id,
        label: f.label,
        type: f.type,
        value: f.value
      }))
    };

    existing.unshift(submission);
    try { localStorage.setItem(REQUESTS_KEY, JSON.stringify(existing)); } catch (e) {
      console.error('[form-details] failed to persist request', e);
    }
    this.router.navigate(['/myrequests']);
  }

  private generateId(): string {
    return 'cat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  private generateRequestRef(formName: string): string {
    const prefix = (formName || 'REQ')
      .split(/\s+/)
      .map(w => (w[0] || '').toUpperCase())
      .join('')
      .slice(0, 4) || 'REQ';
    const suffix = Math.floor(Math.random() * 9000) + 1000;
    return `${prefix}-2026-${suffix}`;
  }

  /** Pick a sensible submitter name from a "Name" or "Reporter" field if the
   *  user filled one in, otherwise a sensible default. */
  private deriveSubmitter(): string {
    for (const f of this.canvasFields) {
      const lbl = (f.label || '').toLowerCase();
      if (/name|reporter|requester|inspector|auditor|supervisor/.test(lbl)) {
        const v = (f.value || '').toString().trim();
        if (v) return v;
      }
    }
    return 'Current User';
  }

  /** Toggle an option on a checkbox field's value array (used in fill-mode). */
  toggleCheckboxOption(f: CanvasField, option: string): void {
    if (!this.fillMode) return;
    const arr = Array.isArray(f.value) ? f.value.slice() : [];
    const idx = arr.indexOf(option);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(option);
    f.value = arr;
  }

  /** Set a radio (single-choice) field's value. */
  setRadioValue(f: CanvasField, option: string): void {
    if (!this.fillMode) return;
    f.value = option;
  }

  onTileClick(tile: ComponentTile): void {
    const field = this.buildFieldFromTile(tile);
    this.canvasFields.push(field);
    this.selectedFieldId = field.id;
    setTimeout(() => {
      const el = document.querySelector('.fb-canvas-field.selected');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  }

  onPreview(): void {
    console.log('[form-details] preview', { title: this.formTitle, fields: this.canvasFields });
    const msg = this.translate.instant('FORM_DETAILS.PREVIEW_MSG', { count: this.canvasFields.length });
    alert(msg);
  }

  selectField(id: number): void {
    this.selectedFieldId = id;
  }

  removeField(id: number, ev?: Event): void {
    if (ev) ev.stopPropagation();
    this.canvasFields = this.canvasFields.filter(f => f.id !== id);
    if (this.selectedFieldId === id) this.selectedFieldId = null;
  }

  duplicateField(id: number, ev?: Event): void {
    if (ev) ev.stopPropagation();
    const idx = this.canvasFields.findIndex(f => f.id === id);
    if (idx < 0) return;
    const src = this.canvasFields[idx];
    const copy: CanvasField = {
      ...src,
      id: this.nextFieldId++,
      options: src.options ? [...src.options] : undefined
    };
    this.canvasFields.splice(idx + 1, 0, copy);
    this.selectedFieldId = copy.id;
  }

  moveField(id: number, dir: -1 | 1, ev?: Event): void {
    if (ev) ev.stopPropagation();
    const idx = this.canvasFields.findIndex(f => f.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= this.canvasFields.length) return;
    const [item] = this.canvasFields.splice(idx, 1);
    this.canvasFields.splice(target, 0, item);
  }

  changeWidth(field: CanvasField, width: 'full' | 'half' | 'third', ev?: Event): void {
    if (ev) ev.stopPropagation();
    field.width = width;
  }

  private buildFieldFromTile(tile: ComponentTile): CanvasField {
    const id = this.nextFieldId++;
    const t = (k: string) => this.translate.instant(k);
    const map: Record<string, () => CanvasField> = {
      'numbers':       () => ({ id, type: 'numbers',       label: t('FORM_DETAILS.LBL_NUMBER'),         width: 'half' }),
      'name':          () => ({ id, type: 'name',          label: t('FORM_DETAILS.LBL_NAME'),           width: 'half' }),
      'email':         () => ({ id, type: 'email',         label: t('FORM_DETAILS.LBL_EMAIL'),          width: 'half' }),
      'address':       () => ({ id, type: 'address',       label: t('FORM_DETAILS.LBL_ADDRESS'),        width: 'full' }),
      'single-line':   () => ({ id, type: 'single-line',   label: t('FORM_DETAILS.LBL_SINGLE_LINE'),    width: 'half' }),
      'heading':       () => ({ id, type: 'heading',       label: t('FORM_DETAILS.LBL_SECTION_HEADING'), width: 'full' }),
      'checkbox':      () => ({ id, type: 'checkbox',      label: t('FORM_DETAILS.LBL_CHECKBOX_GROUP'), width: 'full', options: [t('FORM_DETAILS.OPTION_1'), t('FORM_DETAILS.OPTION_2')] }),
      'single-choice': () => ({ id, type: 'single-choice', label: t('FORM_DETAILS.LBL_SINGLE_CHOICE'),  width: 'full', options: [t('FORM_DETAILS.OPTION_1'), t('FORM_DETAILS.OPTION_2')] }),
      'upload-file':   () => ({ id, type: 'upload-file',   label: t('FORM_DETAILS.LBL_UPLOAD_FILE'),    width: 'full' }),
      'dropdown':      () => ({ id, type: 'dropdown',      label: t('FORM_DETAILS.LBL_DROPDOWN'),       width: 'half', options: [t('FORM_DETAILS.OPTION_1'), t('FORM_DETAILS.OPTION_2')] }),
      'image':         () => ({ id, type: 'image',         label: t('FORM_DETAILS.LBL_IMAGE'),          width: 'full' }),
      'paragraph':     () => ({ id, type: 'paragraph',     label: t('FORM_DETAILS.LBL_PARAGRAPH'),      width: 'full' }),
      'section':       () => ({ id, type: 'section',       label: t('FORM_DETAILS.LBL_SECTION_BREAK'),  width: 'full' }),
      'button':        () => ({ id, type: 'button',        label: t('FORM_DETAILS.LBL_SUBMIT'),         width: 'full' })
    };
    const builder = map[tile.id];
    return builder ? builder() : { id, type: 'single-line', label: this.translate.instant(tile.label), width: 'half' };
  }

  filteredTiles(cat: ComponentCategory): ComponentTile[] {
    const q = this.paletteSearch.trim().toLowerCase();
    if (!q) return cat.tiles;
    return cat.tiles.filter(t => this.translate.instant(t.label).toLowerCase().includes(q));
  }

  toggleCategory(cat: ComponentCategory): void {
    cat.collapsed = !cat.collapsed;
  }

  setTab(tab: PaletteTab): void {
    this.activeTab = tab;
  }

  trackById = (_: number, item: { id: string | number }) => item.id;

  /** True when the given checkbox option label is part of the field's value array. */
  isOptionChecked(f: CanvasField, optionLabel: string): boolean {
    if (Array.isArray(f.value)) return f.value.indexOf(optionLabel) !== -1;
    return f.value === optionLabel;
  }

  /** Wired to the canvas Submit button — saves the form like the top-right
   *  "Save Catalogue" button so the user can submit from inside the form. */
  onCanvasSubmit(ev: Event): void {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    this.onSave();
  }

  // ────────────────────────────────────────────────────────
  // Forms AI Agent — describe a form, agent designs the fields
  // ────────────────────────────────────────────────────────
  aiOpen(): void {
    this.aiPrompt = '';
    this.aiTrace = [];
    this.aiBusy = false;
    this.aiModalOpen = true;
    this.selectedTemplateId = null;
    this.lastChipPrompt = '';
  }

  /** Called from the textarea (ngModelChange) — clears template selection
   *  if the user manually edits away from the chip's prompt. */
  aiOnPromptChange(value: string): void {
    this.aiPrompt = value;
    if (value !== this.lastChipPrompt) {
      this.selectedTemplateId = null;
    }
  }

  aiClose(): void {
    if (this.aiBusy) return;
    this.aiModalOpen = false;
  }

  aiMaybeClose(ev: Event): void {
    if ((ev.target as HTMLElement).classList.contains('fd-modal-backdrop')) {
      this.aiClose();
    }
  }

  aiSetPrompt(suggestion: { id: string; prompt: string }): void {
    if (this.aiBusy) return;
    this.aiPrompt = suggestion.prompt;
    this.lastChipPrompt = suggestion.prompt;
    this.selectedTemplateId = suggestion.id;
  }

  aiGenerate(): void {
    const prompt = (this.aiPrompt || '').trim();
    if (!prompt) {
      alert('Please describe the form you want.');
      return;
    }
    this.aiBusy = true;
    this.aiTrace = [];

    // Predefined chips → use the full hand-curated template (complete form).
    // Custom prompts → keyword-based inference (best effort).
    const template = this.selectedTemplateId ? this.templateForId(this.selectedTemplateId) : null;
    const suggestion = this.selectedTemplateId
      ? this.aiSuggestions.find(s => s.id === this.selectedTemplateId)
      : null;

    const inferred = template ?? this.inferFieldsFromPrompt(prompt);
    const titleGuess = suggestion ? suggestion.title : this.titleFromPrompt(prompt);

    const steps: { kind: 'thinking' | 'tool' | 'ok'; msg: string }[] = [
      { kind: 'thinking', msg: '[reasoning] Parsing prompt: "' + prompt.slice(0, 80) + (prompt.length > 80 ? '…' : '') + '"' },
      { kind: 'tool',     msg: '[schema]    Scanning available field components: 10 builder elements' },
      { kind: 'thinking', msg: '[reasoning] Detected ' + inferred.length + ' field(s) from intent — ' + inferred.map(f => f.type).join(', ') },
      { kind: 'tool',     msg: '[design]    Choosing widths and grouping (full / half / third)' },
      { kind: 'thinking', msg: '[reasoning] Wrapping with a heading and a submit button' },
      { kind: 'tool',     msg: '[render]    Composing form on canvas' },
      { kind: 'ok',       msg: '[result]    Form "' + titleGuess + '" generated with ' + (inferred.length + 2) + ' fields' }
    ];

    let i = 0;
    const tick = () => {
      if (i >= steps.length) {
        try {
          // Reset selection BEFORE swapping the array so trackBy can't keep
          // a stale reference to a field that no longer exists.
          this.selectedFieldId = null;
          this.formTitle = titleGuess;
          this.formDescription = prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt;
          const newFields = this.assembleFields(titleGuess, inferred);
          // New array reference — guarantees ngFor reconciliation.
          this.canvasFields = newFields;
          const maxId = newFields.reduce((m, f) => Math.max(m, f.id || 0), 0);
          this.nextFieldId = maxId + 1;
        } catch (err) {
          console.error('[Forms AI Agent] commit failed', err);
        }
        this.aiBusy = false;
        setTimeout(() => { this.aiModalOpen = false; }, 400);
        return;
      }
      this.aiTrace.push(steps[i]);
      i++;
      setTimeout(tick, 320 + Math.random() * 220);
    };
    tick();
  }

  private titleFromPrompt(prompt: string): string {
    const head = prompt.split(/[,\.\n]/)[0].trim().slice(0, 60);
    // Strip leading "create a/an", "build a/an", "design a/an", "make a/an", "form for"
    const cleaned = head.replace(/^(create|build|design|make|generate)\s+(a|an)?\s*/i, '')
                        .replace(/\s+(form|catalogue|catalog)\s*$/i, '');
    const titled = cleaned.replace(/\b\w/g, c => c.toUpperCase()).trim();
    return titled || 'Untitled Form';
  }

  private inferFieldsFromPrompt(prompt: string): CanvasField[] {
    const p = ' ' + prompt.toLowerCase() + ' ';
    // Start IDs above any value that could exist on the default canvas
    // schemas so *ngFor trackBy never reuses a stale DOM element.
    let nextId = Math.max(this.nextFieldId, 1000) + 1;
    const id = () => nextId++;
    const fields: CanvasField[] = [];

    // Detection rules — order matters so identifiers stay readable on the canvas
    if (/\b(inspector|requester|auditor|reporter|user|name|full name|first name|last name)\b/.test(p)) {
      fields.push({ id: id(), type: 'name', label: 'Full Name', width: 'half' });
    }
    if (/\b(email|e-mail|mail address)\b/.test(p)) {
      fields.push({ id: id(), type: 'email', label: 'Email', width: 'half' });
    }
    if (/\b(phone|contact|mobile|cell)\b/.test(p)) {
      fields.push({ id: id(), type: 'phone', label: 'Contact Number', width: 'half' });
    }
    if (/\b(date|time|when)\b/.test(p)) {
      fields.push({ id: id(), type: 'single-line', label: 'Date', placeholder: 'DD/MM/YYYY', width: 'half' });
    }
    if (/\b(crew id|crew|worker id|employee|staff id)\b/.test(p)) {
      fields.push({ id: id(), type: 'single-line', label: 'Crew ID', width: 'half' });
    }
    if (/\b(well|well id|wellbore)\b/.test(p)) {
      fields.push({ id: id(), type: 'single-line', label: 'Well ID', width: 'half' });
    }
    if (/\b(cluster)\b/.test(p)) {
      fields.push({ id: id(), type: 'dropdown', label: 'Cluster', width: 'half', options: ['NIMR', 'AL BURJ', 'AMIN', 'TUQAA', 'RAKID'] });
    }
    if (/\b(discipline|trade|skill)\b/.test(p)) {
      fields.push({ id: id(), type: 'dropdown', label: 'Discipline', width: 'half', options: ['Mechanical', 'Civil', 'Electrical', 'Instrument'] });
    }
    if (/\b(hours|duration)\b/.test(p)) {
      fields.push({ id: id(), type: 'numbers', label: 'Hours Worked', width: 'half' });
    }
    if (/\b(quantity|qty|amount)\b/.test(p)) {
      fields.push({ id: id(), type: 'numbers', label: 'Quantity', width: 'half' });
    }
    if (/\b(address|location|site)\b/.test(p)) {
      fields.push({ id: id(), type: 'address', label: 'Location', width: 'full' });
    }
    if (/\b(category|type|item type|item category)\b/.test(p)) {
      fields.push({ id: id(), type: 'dropdown', label: 'Category', width: 'half', options: ['Pipe', 'Cable', 'PPE', 'Tools', 'Consumables'] });
    }
    if (/\b(severity|priority|urgency|risk level)\b/.test(p)) {
      const lbl = /urgency/.test(p) ? 'Urgency' : (/priority/.test(p) ? 'Priority' : (/risk/.test(p) ? 'Risk Level' : 'Severity'));
      const opts = /urgency/.test(p) ? ['Standard', 'Expedited', 'Emergency'] : ['Low', 'Medium', 'High'];
      fields.push({ id: id(), type: 'single-choice', label: lbl, width: 'full', options: opts });
    }
    if (/\b(status|state)\b/.test(p)) {
      fields.push({ id: id(), type: 'single-choice', label: 'Status', width: 'full', options: ['Operational', 'Restricted', 'Shut down'] });
    }
    if (/\b(ppe|helmet|vest|gloves|eye protection|safety)\b/.test(p)) {
      fields.push({ id: id(), type: 'checkbox', label: 'PPE Compliance', width: 'full', options: ['Helmet', 'Vest', 'Gloves', 'Eye protection'] });
    }
    if (/\b(checkbox|checklist|multi-select|options)\b/.test(p) && !fields.some(f => f.type === 'checkbox')) {
      fields.push({ id: id(), type: 'checkbox', label: 'Checklist', width: 'full', options: ['Option 1', 'Option 2', 'Option 3'] });
    }
    if (/\b(radio|yes\/no|yes or no|single choice)\b/.test(p) && !fields.some(f => f.type === 'single-choice')) {
      fields.push({ id: id(), type: 'single-choice', label: 'Choose one', width: 'full', options: ['Yes', 'No'] });
    }
    if (/\b(observation|comment|note|remark|description|justification|message|details|activities)\b/.test(p)) {
      const lbl = /justification/.test(p) ? 'Justification'
                : /activities/.test(p)    ? 'Activities Completed'
                : /observation/.test(p)   ? 'Observations'
                : /description/.test(p)   ? 'Description'
                : 'Comments';
      fields.push({ id: id(), type: 'paragraph', label: lbl, width: 'full' });
    }
    if (/\b(upload|attach|file|photo|image|picture|attachment|document)\b/.test(p)) {
      const lbl = /photo|picture|image/.test(p) ? 'Upload photos'
                : /document/.test(p)            ? 'Upload document'
                : /log/.test(p)                 ? 'Attach daily log'
                : 'Upload file';
      fields.push({ id: id(), type: 'upload-file', label: lbl, width: 'full' });
    }
    if (/\b(signature|sign-off|sign off)\b/.test(p)) {
      fields.push({ id: id(), type: 'image', label: 'Signature', width: 'half' });
    }

    // Fallback if nothing matched — give a sensible 4-field starter
    if (fields.length === 0) {
      fields.push(
        { id: id(), type: 'name',      label: 'Full Name',  width: 'half' },
        { id: id(), type: 'email',     label: 'Email',      width: 'half' },
        { id: id(), type: 'paragraph', label: 'Description', width: 'full' }
      );
    }

    return fields;
  }

  private assembleFields(title: string, body: CanvasField[]): CanvasField[] {
    // Reserve heading and button IDs from the same pool the body fields use,
    // so every entry in the new canvas has a guaranteed-unique ID.
    const bodyMaxId = body.reduce((m, f) => Math.max(m, f.id || 0), 0);
    const headingId = Math.max(bodyMaxId + 1, this.nextFieldId, 1000) + 1;
    const buttonId  = headingId + 1;
    return [
      { id: headingId, type: 'heading', label: title, width: 'full' },
      ...body,
      { id: buttonId,  type: 'button',  label: 'Submit', width: 'full' }
    ];
  }

  /**
   * Hand-curated complete form templates for the predefined suggestion chips.
   * Each returns a fully realistic form with all the fields the corresponding
   * workflow would actually need — required flags, dropdown options, hints.
   * IDs start at 1000+ so they never collide with default schemas (1–11).
   */
  private templateForId(id: string): CanvasField[] | null {
    let next = Math.max(this.nextFieldId, 1000) + 1;
    const newId = () => next++;

    if (id === 'site-inspection') {
      return [
        { id: newId(), type: 'name',         label: 'Inspector Name',     width: 'half', required: true, value: 'Ahmed Al-Hasani' },
        { id: newId(), type: 'single-line',  label: 'Date of Inspection', width: 'half', required: true, placeholder: 'DD/MM/YYYY', value: '03/05/2026' },
        { id: newId(), type: 'dropdown',     label: 'Cluster',            width: 'half', required: true, options: ['NIMR', 'AL BURJ', 'AMIN', 'TUQAA', 'RAKID'], value: 'NIMR' },
        { id: newId(), type: 'single-line',  label: 'Well ID',            width: 'half', required: true, placeholder: 'e.g. 34565', value: '34565' },
        { id: newId(), type: 'address',      label: 'Site Location',      width: 'full', required: true, value: 'Block 9, Pad 12 — NIMR field, 12 km north of base camp' },
        { id: newId(), type: 'single-choice',label: 'Site Status',        width: 'full', required: true, options: ['Operational', 'Restricted', 'Shut down'], value: 'Operational' },
        { id: newId(), type: 'checkbox',     label: 'PPE Compliance',     width: 'full', required: true, options: ['Helmet', 'Safety Vest', 'Gloves', 'Eye Protection'], value: ['Helmet', 'Safety Vest', 'Gloves'] },
        { id: newId(), type: 'paragraph',    label: 'Observations',       width: 'full', required: true, placeholder: 'What was observed during inspection — risks, deviations, good practices', value: 'Routine inspection completed. All scaffolding tagged and within service date. Crew working on flowline tie-in observed without eye protection during grinding — corrective action issued on site.' },
        { id: newId(), type: 'upload-file',  label: 'Site Photos',        width: 'full', placeholder: 'site-12-2026-05-03.jpg, scaffolding-tag.jpg' },
        { id: newId(), type: 'image',        label: 'Inspector Signature',width: 'half', required: true }
      ];
    }

    if (id === 'crew-daily') {
      return [
        { id: newId(), type: 'name',         label: 'Supervisor Name',    width: 'half', required: true, value: 'R. Krishnan' },
        { id: newId(), type: 'single-line',  label: 'Report Date',        width: 'half', required: true, placeholder: 'DD/MM/YYYY', value: '03/05/2026' },
        { id: newId(), type: 'single-line',  label: 'Crew ID',            width: 'half', required: true, placeholder: 'e.g. CW-001', value: 'CW-007' },
        { id: newId(), type: 'dropdown',     label: 'Discipline',         width: 'half', required: true, options: ['Mechanical', 'Civil', 'Electrical', 'Instrument'], value: 'Civil' },
        { id: newId(), type: 'single-line',  label: 'Well ID',            width: 'half', required: true, placeholder: 'e.g. 34565', value: '34565' },
        { id: newId(), type: 'numbers',      label: 'Hours Worked',       width: 'half', required: true, placeholder: '0', value: 9.5 },
        { id: newId(), type: 'paragraph',    label: 'Activities Completed', width: 'full', required: true, placeholder: 'Tasks completed today — quantity, location, status', value: 'Completed mechanical excavation of 240 m³ at flowline route 12. Backfilled 150 m³ on previously cleared section. Crew of 6 deployed; 1 equipment operator on standby.' },
        { id: newId(), type: 'paragraph',    label: 'Issues / Blockers',  width: 'full', placeholder: 'Anything blocking progress, materials needed, escalations', value: 'Awaiting delivery of 56 PE pipe joints — slipping behind by half a shift. PDO permit holder unavailable from 14:00; permit handover delayed.' },
        { id: newId(), type: 'upload-file',  label: 'Daily Log Attachment', width: 'full', placeholder: 'daily-log-2026-05-03.pdf' }
      ];
    }

    if (id === 'incident-report') {
      return [
        { id: newId(), type: 'name',         label: 'Reporter Name',      width: 'half', required: true, value: 'Khalid Al-Mazrouei' },
        { id: newId(), type: 'single-line',  label: 'Date and Time',      width: 'half', required: true, placeholder: 'DD/MM/YYYY HH:mm', value: '03/05/2026 11:42' },
        { id: newId(), type: 'single-line',  label: 'Well ID',            width: 'half', placeholder: 'e.g. 34565', value: '37797' },
        { id: newId(), type: 'address',      label: 'Location',           width: 'full', required: true, value: 'AL BURJ field, Pad 4 — flowline trench section 3' },
        { id: newId(), type: 'dropdown',     label: 'Incident Type',      width: 'half', required: true, options: ['Near Miss', 'Equipment Damage', 'Personal Injury', 'Environmental', 'Property Damage', 'Other'], value: 'Near Miss' },
        { id: newId(), type: 'single-choice',label: 'Severity',           width: 'half', required: true, options: ['Low', 'Medium', 'High', 'Critical'], value: 'Medium' },
        { id: newId(), type: 'paragraph',    label: 'Incident Description', width: 'full', required: true, placeholder: 'What happened, when, who was involved, immediate impact', value: 'Excavator slewed within 1.5 m of an unmarked overhead cable while repositioning. Operator stopped immediately on banksman signal. No contact, no injuries. Work paused until cable route was re-surveyed and re-marked.' },
        { id: newId(), type: 'paragraph',    label: 'Root Cause Notes',   width: 'full', placeholder: 'Initial assessment of contributing factors', value: 'Cable route markings degraded by recent dust storm; not refreshed during morning toolbox. Banksman positioning blind to cable from his vantage point.' },
        { id: newId(), type: 'single-line',  label: 'Witness Names',      width: 'full', placeholder: 'Comma-separated list of witnesses', value: 'M. Hassan (banksman), S. Reddy (operator), A. Al-Harthy (site lead)' },
        { id: newId(), type: 'upload-file',  label: 'Photo Evidence',     width: 'full', placeholder: 'incident-2026-05-03-1142.jpg, cable-route.jpg' },
        { id: newId(), type: 'image',        label: 'Reporter Signature', width: 'half', required: true }
      ];
    }

    if (id === 'material-request') {
      return [
        { id: newId(), type: 'name',         label: 'Requester Name',     width: 'half', required: true, value: 'Ahmed Al-Harthy' },
        { id: newId(), type: 'single-line',  label: 'Request Date',       width: 'half', required: true, placeholder: 'DD/MM/YYYY', value: '03/05/2026' },
        { id: newId(), type: 'single-line',  label: 'Well ID',            width: 'half', required: true, placeholder: 'e.g. 34565', value: '34565' },
        { id: newId(), type: 'dropdown',     label: 'Discipline',         width: 'half', required: true, options: ['Mechanical', 'Civil', 'Electrical', 'Instrument'], value: 'Mechanical' },
        { id: newId(), type: 'dropdown',     label: 'Item Category',      width: 'half', required: true, options: ['Pipe', 'Cable', 'Equipment', 'Tools', 'Consumables'], value: 'Pipe' },
        { id: newId(), type: 'single-line',  label: 'Item Description',   width: 'half', required: true, placeholder: 'e.g. 4" SCH40 carbon steel pipe', value: '4" SCH40 carbon steel pipe — 6m lengths, PE-coated' },
        { id: newId(), type: 'numbers',      label: 'Quantity',           width: 'half', required: true, placeholder: '0', value: 56 },
        { id: newId(), type: 'dropdown',     label: 'Unit',               width: 'half', required: true, options: ['pcs', 'm', 'kg', 'set', 'box', 'roll', 'litre'], value: 'pcs' },
        { id: newId(), type: 'single-choice',label: 'Urgency',            width: 'full', required: true, options: ['Standard (7+ days)', 'Expedited (3–5 days)', 'Emergency (< 24 hrs)'], value: 'Expedited (3–5 days)' },
        { id: newId(), type: 'single-line',  label: 'Required By',        width: 'half', required: true, placeholder: 'DD/MM/YYYY', value: '08/05/2026' },
        { id: newId(), type: 'single-line',  label: 'AFE / Budget Code',  width: 'half', required: true, placeholder: 'AFE-2026-0001', value: 'AFE-2026-0142' },
        { id: newId(), type: 'paragraph',    label: 'Justification',      width: 'full', required: true, placeholder: 'Why this material is needed, impact if not delivered', value: 'Required for cementing crew mobilization to Well 34565. Existing inventory exhausted; vendor partial-shipped 92 of 148 joints. Without this delivery, FLAF Phase 1 welding will stall and rig-on date slips by 5 days.' },
        { id: newId(), type: 'upload-file',  label: 'Supporting Documents', width: 'full', placeholder: 'AFE-quote-V123.pdf, vendor-prequal.pdf' }
      ];
    }

    if (id === 'ppe-audit') {
      return [
        { id: newId(), type: 'name',         label: 'Auditor Name',       width: 'half', required: true, value: 'F. Al-Hamdi' },
        { id: newId(), type: 'single-line',  label: 'Audit Date',         width: 'half', required: true, placeholder: 'DD/MM/YYYY', value: '03/05/2026' },
        { id: newId(), type: 'single-line',  label: 'Crew ID',            width: 'half', required: true, placeholder: 'e.g. CW-001', value: 'CW-002' },
        { id: newId(), type: 'dropdown',     label: 'Discipline',         width: 'half', required: true, options: ['Mechanical', 'Civil', 'Electrical', 'Instrument'], value: 'Mechanical' },
        { id: newId(), type: 'address',      label: 'Audit Location',     width: 'full', required: true, value: 'NIMR field, Pad 12 — Well 34565 worksite' },
        { id: newId(), type: 'checkbox',     label: 'PPE Compliance Checklist', width: 'full', required: true, options: ['Helmet', 'Safety Vest', 'Gloves', 'Eye Protection', 'Safety Boots', 'Hearing Protection'], value: ['Helmet', 'Safety Vest', 'Gloves', 'Safety Boots'] },
        { id: newId(), type: 'single-choice',label: 'Compliance Score',   width: 'full', required: true, options: ['Excellent (> 95%)', 'Good (80–95%)', 'Fair (60–80%)', 'Poor (< 60%)'], value: 'Good (80–95%)' },
        { id: newId(), type: 'paragraph',    label: 'Violations Found',   width: 'full', placeholder: 'List any non-compliance, missing PPE, or unsafe behaviours observed', value: '2 of 6 crew members not wearing eye protection while grinding. Hearing protection absent on 3 crew working near generator (>85 dB).' },
        { id: newId(), type: 'paragraph',    label: 'Corrective Actions', width: 'full', required: true, placeholder: 'Actions taken on the spot and follow-up actions required', value: 'On-site stop-work issued. Crew supervisor briefed. Eye protection and hearing protection issued from supervisor stock. Re-audit scheduled within 48 hrs.' },
        { id: newId(), type: 'upload-file',  label: 'Photo Evidence',     width: 'full', placeholder: 'audit-cw002-2026-05-03.jpg' },
        { id: newId(), type: 'image',        label: 'Auditor Signature',  width: 'half', required: true }
      ];
    }

    return null;
  }
}
