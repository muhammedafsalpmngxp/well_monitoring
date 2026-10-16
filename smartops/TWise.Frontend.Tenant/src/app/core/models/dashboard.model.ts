// ─── Dashboard Status ────────────────────────────────────────────────────────

export type DashboardStatus = 'Draft' | 'Published' | 'Completed' | 'Inactive' | 'Deleted';

// ─── Request DTOs ────────────────────────────────────────────────────────────

/** Matches backend SaveDashboardRequest (used for create & update). */
export interface SaveDashboardRequest {
  dashboardName: string;
  categoryId: number;
  description?: string;
  configJson?: string;
}

/** Layout item types used by the future unified dashboard canvas. */
export type DashboardLayoutItemType = 'tile' | 'chart';

/** A persisted item position in the dashboard builder grid. */
export interface DashboardLayoutItem {
  id: number;
  type: DashboardLayoutItemType;
  sortOrder: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
  width?: number | null;
  height?: number | null;
}

/** Versioned layout section added without changing the dashboard API DTO. */
export interface DashboardLayoutConfig {
  version: 1;
  columns: number;
  items: DashboardLayoutItem[];
}

/** Current dashboard config shape, including the legacy fields still in use. */
export interface DashboardConfig {
  widgets: DashboardConfigWidget[];
  chartColumns?: number;
  layout?: DashboardLayoutConfig;
  branding?: DashboardBranding;
}

export interface DashboardLogoAsset {
  assetId: string;
  fileName: string;
  size: number;
}

export interface DashboardBranding {
  leftLogo?: DashboardLogoAsset | null;
  rightLogo?: DashboardLogoAsset | null;
}

export function normalizeDashboardBranding(value: unknown): DashboardBranding {
  const source = value && typeof value === 'object' ? value as DashboardBranding : {};
  const normalize = (asset: DashboardLogoAsset | null | undefined): DashboardLogoAsset | null => {
    if (!asset || typeof asset.assetId !== 'string' || !/^[1-9][0-9]*_[a-f0-9]{32}\.(png|jpg|webp)$/.test(asset.assetId)) return null;
    return { assetId: asset.assetId, fileName: typeof asset.fileName === 'string' ? asset.fileName.slice(0, 150) : 'Logo', size: Number(asset.size) || 0 };
  };
  return { leftLogo: normalize(source.leftLogo), rightLogo: normalize(source.rightLogo) };
}

/** Existing widget entry persisted by URL2. */
export interface DashboardConfigWidget {
  chartId: number;
  sortOrder: number;
  type: DashboardLayoutItemType;
  width?: number | null;
  height?: number | null;
  /** A chart's user-placed position (drag or resize), persisted so it's reused verbatim on every
   *  future layout recompute instead of being reflowed. Absent/null means "not placed yet" —
   *  the layout builder assigns it a default spot the first time, then never touches it again. */
  x?: number | null;
  y?: number | null;
}

// ─── Response DTOs ───────────────────────────────────────────────────────────

/** Returned after successful dashboard creation. */
export interface CreateDashboardResponse {
  dashboardId: number;
  dashboardName: string;
  categoryId: number;
  status: string;
  message: string;
}

/** Returned after successful dashboard update. */
export interface UpdateDashboardResponse {
  dashboardId: number;
  dashboardName: string;
  status: string;
  message: string;
}

/** Returned after publishing a dashboard. */
export interface PublishDashboardResponse {
  dashboardId: number;
  status: string;
  message: string;
}

/** Returned after completing a dashboard. */
export interface CompleteDashboardResponse {
  dashboardId: number;
  status: string;
  message: string;
}

/** Returned after reopening a Completed dashboard back to Draft. */
export interface ReopenDashboardResponse {
  dashboardId: number;
  status: string;
  message: string;
}

/** Returned after toggling active state. */
export interface ToggleDashboardActiveResponse {
  dashboardId: number;
  isActive: boolean;
  message: string;
}

export interface DashboardShareLinkResponse {
  dashboardId: number;
  token: string;
}

export interface ShareDashboardInternallyResponse {
  dashboardId: number;
  sharedWithCount: number;
}

// ─── Listing DTOs ────────────────────────────────────────────────────────────

/** Dashboards grouped by category (used by WIP and Published endpoints). */
export interface DashboardCategoryResponse {
  categoryId: number;
  categoryName: string;
  dashboardCount: number;
  dashboards: DashboardSummaryResponse[];
}

/** Summary of a single dashboard within a category group. */
export interface DashboardSummaryResponse {
  dashboardId: number;
  dashboardName: string;
  categoryId: number;
  categoryName: string;
  status: DashboardStatus;
  description?: string;
  widgetCount: number;
  modifiedDate?: string;
  createdBy?: string;
  versionNo?: number | null;
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/** Full dashboard with widgets (for edit page). */
export interface DashboardDetailResponse {
  dashboardId: number;
  dashboardName: string;
  categoryId: number;
  categoryName: string;
  status: DashboardStatus;
  description?: string;
  configJson?: string;
  isActive: boolean;
  versionNo?: number | null;
  isLatestVersion: boolean;
}

/** A single published version of a dashboard series (GET /api/dashboard/:id/versions). */
export interface DashboardVersionSummaryResponse {
  dashboardId: number;
  versionNo: number;
  status: string;
  isLatestVersion: boolean;
  publishedBy?: string;
  modifiedDate?: string;
}

/**
 * Result of restoring a dashboard to an earlier published version.
 * Restore is append-only, so this describes a NEWLY created version.
 */
export interface RestoreDashboardVersionResponse {
  /** Id of the new version created by the restore, not the version restored from. */
  dashboardId: number;
  restoredFromVersionNo: number;
  newVersionNo: number;
  status: string;
  message: string;
}

// ─── Widget Library (for Dashboard Builder sidebar) ──────────────────────────

/** Grouped response from GET /api/dashboard/widgets/library. */
export interface WidgetLibraryResponse {
  tiles: WidgetLibraryItem[];
  charts: WidgetLibraryItem[];
}

/** A single widget item in the library sidebar. */
export interface WidgetLibraryItem {
  id: number;
  name: string;
  description?: string;
  type: string;
  libraryId?: number;
  source: string;
  sourceType: string;
  sourceId?: number | null;
  designJson?: string;
  status: string;
  categoryId?: number;
  categoryName?: string;
}
