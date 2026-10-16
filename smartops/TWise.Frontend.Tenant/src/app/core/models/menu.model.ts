export interface MenuItem {
  label: string;
  icon?: string;
  route?: string;
  badge?: string;
  children?: MenuItem[];
  moduleCode?: string;
  hidden?: boolean;
  /** Shown only to tenant admins, regardless of module permissions. */
  adminOnly?: boolean;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}
