import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LearnChapterDto, LearnVideoDto, LearnVideoService } from '../../../core/services/learn-video.service';
import { PermissionService } from '../../../core/services/permission.service';

/** Screens that have a Learn button; listed even before a video is configured so admins see the gaps. */
const SCREENS: { key: string; name: string }[] = [
  { key: 'chart-builder', name: 'Chart Builder' },
  { key: 'tile-builder', name: 'Tile Builder' },
  { key: 'report-builder', name: 'Report Builder' },
  { key: 'dashboard-builder', name: 'Dashboard Builder' },
];

interface ScreenRow { key: string; name: string; video: LearnVideoDto | null }

/**
 * Admin page for the "Learn" videos: which S3 URL each builder screen plays, its poster and the
 * Quick Chapters. Saving writes core.LearnVideos through the API; the builders read it on the next
 * open, so a recording can be replaced without a release.
 */
@Component({
  selector: 'app-learn-videos',
  standalone: false,
  templateUrl: './learn-videos.component.html',
  styleUrls: ['./learn-videos.component.scss'],
})
export class LearnVideosComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  canEdit(row: ScreenRow): boolean {
    return this.permissions.canView('settings.learn-videos') && (row.video
      ? this.permissions.canModify('settings.learn-videos')
      : this.permissions.canCreate('settings.learn-videos'));
  }

  private readonly destroyRef = inject(DestroyRef);

  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Settings', route: '/settings' }, { label: 'Learn Videos' }];
  rows: ScreenRow[] = SCREENS.map(s => ({ ...s, video: null }));
  loading = true;
  error = '';

  /** Edit dialog. */
  editing: ScreenRow | null = null;
  form = { title: '', videoUrl: '', posterUrl: '', isActive: true, chapters: [] as LearnChapterDto[] };
  saving = false;
  formError = '';
  /** Set once the preview player has loaded the URL, so the admin knows the file is reachable. */
  previewState: 'idle' | 'ok' | 'failed' = 'idle';

  constructor(
    private readonly learnVideos: LearnVideoService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.learnVideos.list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (videos) => {
          const byKey = new Map(videos.map(v => [v.screenKey, v]));
          // Rows for known screens first, then any extra screen keys an admin added.
          const known = SCREENS.map(s => ({ ...s, video: byKey.get(s.key) ?? null }));
          const extra = videos.filter(v => !SCREENS.some(s => s.key === v.screenKey)).map(v => ({ key: v.screenKey, name: v.screenKey, video: v }));
          this.rows = [...known, ...extra];
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => { this.loading = false; this.error = err?.error?.message ?? 'The video list could not be loaded.'; this.cdr.markForCheck(); },
      });
  }

  openEdit(row: ScreenRow): void {
    if (!this.canEdit(row)) return;
    this.editing = row;
    const v = row.video;
    this.form = {
      title: v?.title ?? row.name,
      videoUrl: v?.videoUrl ?? '',
      posterUrl: v?.posterUrl ?? '',
      isActive: v?.isActive ?? true,
      chapters: (v?.chapters ?? []).map(c => ({ ...c })),
    };
    this.formError = '';
    this.previewState = 'idle';
  }

  closeEdit(): void {
    if (!this.saving) this.editing = null;
  }

  addChapter(): void {
    const n = this.form.chapters.length + 1;
    this.form.chapters.push({ id: `chapter-${n}`, label: '', time: this.form.chapters.at(-1)?.time ?? 0, durationLabel: '' });
  }

  removeChapter(index: number): void {
    this.form.chapters.splice(index, 1);
  }

  get canSave(): boolean {
    return !!this.form.title.trim() && /^https:\/\//i.test(this.form.videoUrl.trim());
  }

  save(): void {
    if (!this.editing || !this.canEdit(this.editing)) return;
    this.saving = true;
    this.formError = '';
    const key = this.editing.key;
    this.learnVideos.save(key, {
      title: this.form.title.trim(),
      videoUrl: this.form.videoUrl.trim(),
      posterUrl: this.form.posterUrl.trim() || null,
      chapters: this.form.chapters.filter(c => c.label.trim()),
      isActive: this.form.isActive,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.saving = false;
          this.rows = this.rows.map(r => r.key === key ? { ...r, video: saved } : r);
          this.editing = null;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.saving = false;
          this.formError = err?.error?.message ?? 'The video could not be saved.';
          this.cdr.markForCheck();
        },
      });
  }
}
