import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiFeatureAccess, AiFeatureDef, AiPromptDto, AiProvider, AiProviderDto, AiService, AiSettingsDto, AiTestResultDto, AiUsageSummaryDto } from '../../../core/services/ai.service';
import { RoleDto, UserManagementService } from '../../../core/services/user-management.service';

/** Sensible endpoint/model per provider type, applied when the admin switches type in the dialog. */
export const PROVIDER_DEFAULTS: Record<AiProvider, { label: string; baseUrl: string; model: string; needsKey: boolean }> = {
  openai:    { label: 'OpenAI',                  baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o-mini',    needsKey: true },
  anthropic: { label: 'Anthropic (Claude)',      baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', needsKey: true },
  azure:     { label: 'Azure OpenAI',            baseUrl: 'https://<resource>.openai.azure.com/openai/deployments/<deployment>', model: '<deployment>', needsKey: true },
  ollama:    { label: 'Ollama (local, no key)',  baseUrl: 'http://localhost:11434/v1',    model: 'llama3.1',       needsKey: false },
  custom:    { label: 'Other OpenAI-compatible', baseUrl: 'https://',                      model: '',               needsKey: true },
};

interface ProviderForm { name: string; provider: AiProvider; baseUrl: string; model: string; fastModel: string; apiKey: string }

/**
 * Admin page: the tenant's registered LLM providers (one active), the daily call quota, the on/off
 * switch, and usage. Providers are added or edited in a dialog; the key is write-only.
 */
@Component({
  selector: 'app-ai-settings',
  standalone: false,
  templateUrl: './ai-settings.component.html',
  styleUrls: ['./ai-settings.component.scss'],
})
export class AiSettingsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  /** Which page this instance renders: providers (+ limits, usage) or the features-by-role matrix. */
  readonly section: 'providers' | 'features' = inject(ActivatedRoute).snapshot.data['section'] ?? 'providers';
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Settings', route: '/settings' }, { label: this.section === 'features' ? 'AI Features' : 'AI Providers' }];
  readonly providerTypes = Object.entries(PROVIDER_DEFAULTS).map(([value, d]) => ({ value: value as AiProvider, label: d.label }));

  providers: AiProviderDto[] = [];
  settings = { dailyQuota: 500, isEnabled: false };

  /** Feature-by-role matrix; every role, including admin, is a normal column. */
  featureDefs: AiFeatureDef[] = [];
  roles: RoleDto[] = [];
  access: Record<string, Set<string>> = {};
  savingAccess = false;
  accessMessage = '';
  /** Editable AI instructions with the admin's unsaved text per key. */
  prompts: AiPromptDto[] = [];
  drafts: Record<string, string> = {};
  promptMessage: Record<string, string> = {};
  savingPrompt: string | null = null;
  usage: AiUsageSummaryDto | null = null;
  loading = true;
  error = '';
  savingSettings = false;
  settingsMessage = '';
  /** Per-provider transient state: test result and in-flight flags. */
  testResults = new Map<number, AiTestResultDto>();
  busyId: number | null = null;

  /** Add/edit dialog. */
  editing: AiProviderDto | null | undefined; // undefined = closed, null = new
  form: ProviderForm = this.blankForm();
  dialogError = '';
  savingProvider = false;

  constructor(private readonly ai: AiService, private readonly users: UserManagementService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.ai.getSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => { this.settings = this.pick(s); this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message ?? 'AI settings could not be loaded.'; this.cdr.markForCheck(); },
    });
    this.loadProviders();
    if (this.section === 'providers') this.loadUsage(); else this.loadAccess();
  }

  get activeProvider(): AiProviderDto | undefined { return this.providers.find(p => p.isActive); }

  typeLabel(p: AiProvider): string { return PROVIDER_DEFAULTS[p]?.label ?? p; }

  // ── Tenant settings ────────────────────────────────────────────────────────

  saveSettings(): void {
    this.savingSettings = true;
    this.settingsMessage = this.error = '';
    this.ai.saveSettings(this.settings).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => { this.settings = this.pick(s); this.ai.refreshFeatures(); this.savingSettings = false; this.settingsMessage = 'Saved.'; this.cdr.markForCheck(); },
      error: err => { this.savingSettings = false; this.error = err?.error?.message ?? 'The settings could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  openAdd(): void {
    this.editing = null;
    this.form = this.blankForm();
    this.dialogError = '';
  }

  openEdit(p: AiProviderDto): void {
    this.editing = p;
    this.form = { name: p.name, provider: p.provider, baseUrl: p.baseUrl, model: p.model, fastModel: p.fastModel ?? '', apiKey: '' };
    this.dialogError = '';
  }

  closeDialog(): void {
    if (!this.savingProvider) this.editing = undefined;
  }

  onTypeChange(): void {
    const d = PROVIDER_DEFAULTS[this.form.provider];
    this.form.baseUrl = d.baseUrl;
    this.form.model = d.model;
    if (!this.form.name.trim()) this.form.name = d.label;
  }

  get needsKey(): boolean { return PROVIDER_DEFAULTS[this.form.provider].needsKey; }

  get canSaveProvider(): boolean {
    const f = this.form;
    const keyOk = !this.needsKey || !!f.apiKey.trim() || !!this.editing?.hasApiKey;
    return !!f.name.trim() && !!f.baseUrl.trim() && !!f.model.trim() && keyOk && !this.savingProvider;
  }

  saveProvider(): void {
    if (!this.canSaveProvider) return;
    this.savingProvider = true;
    this.dialogError = '';
    const req = { name: this.form.name.trim(), provider: this.form.provider, baseUrl: this.form.baseUrl.trim(), model: this.form.model.trim(),
      fastModel: this.form.fastModel.trim() || null, apiKey: this.form.apiKey.trim() || null };
    const call$ = this.editing ? this.ai.updateProvider(this.editing.id, req) : this.ai.addProvider(req);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.savingProvider = false; this.editing = undefined; this.loadProviders(); },
      error: err => { this.savingProvider = false; this.dialogError = err?.error?.message ?? 'The provider could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  activate(p: AiProviderDto): void {
    this.busyId = p.id;
    this.ai.activateProvider(p.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busyId = null; this.loadProviders(); },
      error: err => { this.busyId = null; this.error = err?.error?.message ?? 'The provider could not be activated.'; this.cdr.markForCheck(); },
    });
  }

  test(p: AiProviderDto): void {
    this.busyId = p.id;
    this.testResults.delete(p.id);
    this.ai.testProvider(p.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { this.busyId = null; this.testResults.set(p.id, r); this.loadUsage(); this.cdr.markForCheck(); },
      error: err => { this.busyId = null; this.testResults.set(p.id, { success: false, message: err?.error?.message ?? 'The test request failed.', latencyMs: 0 }); this.cdr.markForCheck(); },
    });
  }

  remove(p: AiProviderDto): void {
    this.busyId = p.id;
    this.ai.deleteProvider(p.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busyId = null; this.loadProviders(); },
      error: err => { this.busyId = null; this.error = err?.error?.message ?? 'The provider could not be deleted.'; this.cdr.markForCheck(); },
    });
  }

  trackProvider(_: number, p: AiProviderDto): number { return p.id; }

  private pick(s: AiSettingsDto) {
    return { dailyQuota: s.dailyQuota, isEnabled: s.isEnabled };
  }

  // ── Feature access by role ─────────────────────────────────────────────────

  hasAccess(feature: string, role: string): boolean { return !!this.access[feature]?.has(role); }

  toggleAccess(feature: string, role: string, on: boolean): void {
    (this.access[feature] ??= new Set()); on ? this.access[feature].add(role) : this.access[feature].delete(role);
  }

  saveAccess(): void {
    this.savingAccess = true;
    this.accessMessage = '';
    const payload: Record<string, string[]> = {};
    for (const f of this.featureDefs) payload[f.key] = [...(this.access[f.key] ?? [])];
    this.ai.saveFeatureAccess(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: a => { this.applyAccess(a); this.ai.refreshFeatures(); this.savingAccess = false; this.accessMessage = 'Saved.'; this.cdr.markForCheck(); },
      error: err => { this.savingAccess = false; this.accessMessage = err?.error?.message ?? 'The access could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  // ── AI instructions ────────────────────────────────────────────────────────

  /** Save the draft; an empty text resets to the default. */
  savePrompt(p: AiPromptDto, reset = false): void {
    this.savingPrompt = p.key;
    this.promptMessage[p.key] = '';
    this.ai.savePrompt(p.key, reset ? '' : this.drafts[p.key]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => { this.applyPrompts(list); this.savingPrompt = null; this.promptMessage[p.key] = reset ? 'Default restored.' : 'Saved.'; this.cdr.markForCheck(); },
      error: err => { this.savingPrompt = null; this.promptMessage[p.key] = err?.error?.message ?? 'The text could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  private applyPrompts(list: AiPromptDto[]): void {
    this.prompts = list;
    this.drafts = Object.fromEntries(list.map(p => [p.key, p.text]));
  }

  private applyAccess(a: AiFeatureAccess): void {
    this.featureDefs = a.features;
    this.access = {};
    for (const [k, roles] of Object.entries(a.access)) this.access[k] = new Set(roles);
  }

  private loadAccess(): void {
    this.ai.prompts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: p => { this.applyPrompts(p); this.cdr.markForCheck(); }, error: () => { /* card stays empty */ } });
    this.ai.featureAccess().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: a => { this.applyAccess(a); this.cdr.markForCheck(); }, error: () => { /* card stays empty */ } });
    this.users.listRoles().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { this.roles = r.items.filter(x => x.isActive); this.cdr.markForCheck(); },
      error: () => { /* card stays empty */ },
    });
  }

  private blankForm(): ProviderForm {
    const d = PROVIDER_DEFAULTS.openai;
    return { name: '', provider: 'openai', baseUrl: d.baseUrl, model: d.model, fastModel: '', apiKey: '' };
  }

  private loadProviders(): void {
    this.ai.providers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => { this.providers = p; this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.loading = false; this.error = err?.error?.message ?? 'Providers could not be loaded.'; this.cdr.markForCheck(); },
    });
  }

  private loadUsage(): void {
    this.ai.getUsage(14).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: u => { this.usage = u; this.cdr.markForCheck(); },
      error: () => { /* usage is informational */ },
    });
  }
}
