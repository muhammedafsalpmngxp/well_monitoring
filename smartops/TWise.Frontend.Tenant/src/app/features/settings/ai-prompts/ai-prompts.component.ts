import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiPromptItem, AiPromptVersion, AiService } from '../../../core/services/ai.service';

/** The built-in prompt groups, in the order the API lists them. Each Agentic Feature adds its own group (from the API). */
export const PROMPT_GROUPS: { key: string; title: string; hint: string }[] = [
  { key: 'features', title: 'AI features', hint: 'Chart and dashboard explanations, filter and chart suggestions, alerts, SQL review, slide decks.' },
  { key: 'askdata', title: 'Ask Data', hint: 'The multi-agent engine behind Ask your data and agent Ask Data steps: its system prompts, business rules and examples.' },
  { key: 'askdata-messages', title: 'Ask Data templates', hint: 'What each Ask Data step adds to its message: labels, retry notes, chart rules. Keep the {PLACEHOLDERS}: the run\'s data goes there.' },
  { key: 'agents', title: 'Agents', hint: 'How agents decide and answer: supervisor, router, loop check and the final combined answer.' },
];

interface Message { ok: boolean; text: string }

/**
 * AI Settings → AI Prompts (admins only): every AI prompt of the tenant, stored in the tenant database. Each save is a
 * new version with who, when and an optional note; any version, or the original, can be restored. Changes apply to
 * the next question. The server refuses a text that drops a {PLACEHOLDER} or a reply key the code needs, and a save
 * over someone else's newer version.
 */
@Component({
  selector: 'app-ai-prompts',
  standalone: false,
  templateUrl: './ai-prompts.component.html',
  styleUrls: ['./ai-prompts.component.scss'],
})
export class AiPromptsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  /** The built-in groups, then one per Agentic Feature (Slippage, Daily Report, Data Anomaly), as the API lists them. */
  groups = [...PROMPT_GROUPS];
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'AI Settings', route: '/settings/ai' }, { label: 'AI Prompts' }];
  readonly maxLength = 100_000;

  items: AiPromptItem[] = [];
  loading = true;
  error = '';
  activeGroup = inject(ActivatedRoute).snapshot.queryParamMap.get('group') ?? PROMPT_GROUPS[0].key;
  search = '';
  openKey: string | null = null;
  drafts: Record<string, string> = {};
  notes: Record<string, string> = {};
  saving: string | null = null;
  messages: Record<string, Message> = {};
  history: Record<string, AiPromptVersion[]> = {};
  historyOpen: string | null = null;
  historyLoading: string | null = null;
  viewing: AiPromptVersion | null = null;

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.load();
    this.loadFeatureGroups();
  }

  /** Each Agentic Feature's prompts are a group of their own, titled and described as the feature is. */
  private loadFeatureGroups(): void {
    this.ai.featureSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: features => {
        const extra = features.map(f => ({ key: f.feature, title: f.title,
          hint: `${f.description} Keep the {PLACEHOLDERS}: the feature's data goes there.` }));
        this.groups = [...PROMPT_GROUPS, ...extra, ...this.groups.filter(g => !PROMPT_GROUPS.some(p => p.key === g.key) && !extra.some(e => e.key === g.key))];
        this.cdr.markForCheck();
      },
      error: () => { /* the groups found in the prompts themselves are shown */ },
    });
  }

  /** A group the prompts use that no list names yet (shown under its key until the features load). */
  private addMissingGroups(): void {
    for (const g of new Set(this.items.map(i => i.group)))
      if (!this.groups.some(x => x.key === g)) this.groups = [...this.groups, { key: g, title: g, hint: '' }];
    if (!this.groups.some(g => g.key === this.activeGroup)) this.activeGroup = PROMPT_GROUPS[0].key;
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.ai.promptLibrary().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: items => {
        this.items = items;
        this.addMissingGroups();
        this.drafts = Object.fromEntries(items.map(i => [i.key, i.text]));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.loading = false;
        this.error = err?.status === 403 ? 'Only admins can see the AI prompts.' : (err?.error?.message ?? 'The AI prompts could not be loaded.');
        this.cdr.markForCheck();
      },
    });
  }

  /** The prompts of the active group, filtered by the search words (name, key, description, text). */
  get shown(): AiPromptItem[] {
    const words = this.search.toLowerCase().split(/\s+/).filter(Boolean);
    return this.items.filter(i => (words.length ? true : i.group === this.activeGroup) &&
      words.every(w => `${i.name} ${i.key} ${i.description} ${i.text}`.toLowerCase().includes(w)));
  }

  count(group: string): number { return this.items.filter(i => i.group === group).length; }
  edited(group: string): number { return this.items.filter(i => i.group === group && this.isEdited(i)).length; }
  groupTitle(key: string): string { return this.groups.find(g => g.key === key)?.title ?? key; }
  groupHint(key: string): string { return this.groups.find(g => g.key === key)?.hint ?? ''; }

  isEdited(i: AiPromptItem): boolean { return i.text !== i.originalText; }
  isDirty(i: AiPromptItem): boolean { return (this.drafts[i.key] ?? '') !== i.text; }

  /** Placeholders and reply keys the draft has lost: the server would refuse it. */
  missing(i: AiPromptItem): string[] {
    const draft = this.drafts[i.key] ?? '';
    return [...i.placeholders.filter(p => !draft.includes(`{${p}}`)).map(p => `{${p}}`),
            ...i.replyKeys.filter(k => !draft.includes(`"${k}"`)).map(k => `"${k}"`)];
  }

  rows(i: AiPromptItem): number { return Math.min(28, Math.max(4, (this.drafts[i.key] ?? '').split('\n').length + 1)); }

  toggle(i: AiPromptItem): void {
    this.openKey = this.openKey === i.key ? null : i.key;
    this.viewing = null;
  }

  selectGroup(key: string): void {
    this.activeGroup = key;
    this.search = '';
    this.openKey = null;
  }

  discard(i: AiPromptItem): void {
    this.drafts[i.key] = i.text;
    this.messages[i.key] = { ok: true, text: 'Changes discarded.' };
  }

  save(i: AiPromptItem): void {
    this.saving = i.key;
    this.messages[i.key] = { ok: true, text: '' };
    this.ai.savePromptVersion(i.key, this.drafts[i.key] ?? '', this.notes[i.key] ?? '', i.version)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: saved => this.applied(saved, saved.version === i.version ? 'No change to save.' : `Saved as version ${saved.version}. It applies to the next question.`),
        error: err => this.failed(i.key, err, 'The prompt could not be saved.'),
      });
  }

  /** The restore waiting for the admin's answer in the app's confirmation dialog. */
  pendingRestore: { item: AiPromptItem; version: number } | null = null;

  restoreLabel(version: number): string { return version === 1 ? 'the original text' : `version ${version}`; }

  get restoreMessage(): string {
    const p = this.pendingRestore;
    return p ? `Make ${this.restoreLabel(p.version)} the active text of "${p.item.name}"? The current text stays in the history.` : '';
  }

  restore(i: AiPromptItem, version: number): void { this.pendingRestore = { item: i, version }; }

  confirmRestore(): void {
    const p = this.pendingRestore;
    this.pendingRestore = null;
    if (!p) return;
    const i = p.item, version = p.version, label = this.restoreLabel(version);
    this.saving = i.key;
    this.ai.restorePrompt(i.key, version, i.version).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: saved => this.applied(saved, saved.version === i.version ? 'That text is already active.' : `Restored ${label} as version ${saved.version}.`),
      error: err => this.failed(i.key, err, 'The prompt could not be restored.'),
    });
  }

  toggleHistory(i: AiPromptItem): void {
    this.viewing = null;
    if (this.historyOpen === i.key) { this.historyOpen = null; return; }
    this.historyOpen = i.key;
    this.loadHistory(i.key);
  }

  view(v: AiPromptVersion): void { this.viewing = this.viewing?.version === v.version ? null : v; }

  actionLabel(v: AiPromptVersion): string {
    return v.action === 'seed' ? 'Original' : v.action === 'restore' ? 'Restored' : 'Edited';
  }

  trackItem(_: number, i: AiPromptItem): string { return i.key; }
  trackVersion(_: number, v: AiPromptVersion): number { return v.version; }

  private loadHistory(key: string): void {
    this.historyLoading = key;
    this.ai.promptHistory(key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: versions => { this.history[key] = versions; this.historyLoading = null; this.cdr.markForCheck(); },
      error: err => { this.historyLoading = null; this.failed(key, err, 'The history could not be loaded.'); },
    });
  }

  private applied(saved: AiPromptItem, text: string): void {
    this.items = this.items.map(x => (x.key === saved.key ? saved : x));
    this.drafts[saved.key] = saved.text;
    this.notes[saved.key] = '';
    this.saving = null;
    this.viewing = null;
    this.messages[saved.key] = { ok: true, text };
    if (this.historyOpen === saved.key) this.loadHistory(saved.key);
    this.cdr.markForCheck();
  }

  private failed(key: string, err: any, fallback: string): void {
    this.saving = null;
    this.messages[key] = { ok: false, text: err?.status === 403 ? 'Only admins can change the AI prompts.' : (err?.error?.message ?? fallback) };
    this.cdr.markForCheck();
  }
}
