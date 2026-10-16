import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { PermissionService } from '../../../core/services/permission.service';
import { MailGroupDto, SCHEDULES_MODULE, ScheduleService } from '../../../core/services/schedule.service';
import { parseAddresses } from '../../../shared/schedule-dialog/recipients.util';
import { apiErrorMessage } from '../../model-studio/model-studio.util';

/** The Mail groups tab of Schedules: named lists of addresses that schedules can send to. */
@Component({
  selector: 'app-mail-groups',
  standalone: false,
  templateUrl: './mail-groups.component.html',
  styleUrls: ['../schedules/delivery-pages.scss', './mail-groups.component.scss'],
})
export class MailGroupsComponent implements OnInit, OnDestroy {
  groups: MailGroupDto[] = [];
  loading = true;
  error = '';
  toast: { kind: 'success' | 'error'; text: string } | null = null;

  /** The form: open with editing null to create. */
  formOpen = false;
  editing: MailGroupDto | null = null;
  form = { name: '', description: '', members: [] as string[], draft: '' };
  formError = '';
  saving = false;
  pendingDelete: MailGroupDto | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly service: ScheduleService,
    private readonly permissions: PermissionService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  get canCreate(): boolean { return this.permissions.canCreate(SCHEDULES_MODULE); }
  get canModify(): boolean { return this.permissions.canModify(SCHEDULES_MODULE); }

  ngOnInit(): void {
    this.service.mailGroups().subscribe({
      next: groups => { this.groups = groups; this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.error = apiErrorMessage(err, 'Mail groups could not be loaded.'); this.loading = false; this.cdr.markForCheck(); },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
  }

  trackGroup(_: number, g: MailGroupDto): number { return g.id; }
  trackText(_: number, text: string): string { return text; }

  open(group: MailGroupDto | null): void {
    this.editing = group;
    this.form = { name: group?.name ?? '', description: group?.description ?? '', members: [...(group?.members ?? [])], draft: '' };
    this.formError = '';
    this.formOpen = true;
  }

  /** Adds the typed or pasted addresses; what is not an address stays in the box. */
  addMembers(): void {
    const { valid, invalid } = parseAddresses(this.form.draft);
    const seen = new Set(this.form.members.map(m => m.toLowerCase()));
    this.form.members = [...this.form.members, ...valid.filter(v => !seen.has(v.toLowerCase()))];
    this.form.draft = invalid.join(' ');
    this.formError = invalid.length ? `Not an email address: ${invalid.join(', ')}` : '';
  }

  onDraftKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      this.addMembers();
    }
  }

  removeMember(member: string): void {
    this.form.members = this.form.members.filter(m => m !== member);
  }

  save(): void {
    this.formError = '';
    if (this.form.draft.trim()) this.addMembers();
    const name = this.form.name.trim();
    if (!name) { this.formError = 'Give the group a name.'; return; }
    if (!this.form.members.length) { this.formError = 'Add at least one email address.'; return; }
    if (this.formError) return;
    this.saving = true;
    const body = { name, description: this.form.description.trim() || undefined, members: this.form.members };
    const editing = this.editing;
    (editing ? this.service.updateMailGroup(editing.id, body) : this.service.createMailGroup(body)).subscribe({
      next: saved => {
        this.saving = false;
        this.formOpen = false;
        this.groups = editing ? this.groups.map(g => g.id === saved.id ? saved : g) : [...this.groups, saved];
        this.showToast('success', `"${saved.name}" was saved.`);
      },
      error: err => {
        this.saving = false;
        this.formError = apiErrorMessage(err, 'The mail group could not be saved.');
        this.cdr.markForCheck();
      },
    });
  }

  confirmDelete(): void {
    const group = this.pendingDelete;
    this.pendingDelete = null;
    if (!group) return;
    this.service.deleteMailGroup(group.id).subscribe({
      next: () => {
        this.groups = this.groups.filter(g => g.id !== group.id);
        this.showToast('success', `"${group.name}" was deleted.`);
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The mail group could not be deleted.')),
    });
  }

  get deleteMessage(): string {
    return `Delete "${this.pendingDelete?.name ?? ''}"? Schedules that send to it will no longer reach its addresses.`;
  }

  private showToast(kind: 'success' | 'error', text: string): void {
    this.toast = { kind, text };
    this.cdr.markForCheck();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; this.cdr.markForCheck(); }, 4000);
  }
}
