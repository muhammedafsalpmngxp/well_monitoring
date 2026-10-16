/** Common navbar-bell notification item, normalized from any backend notification source. */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  description: string;
  changedAt: string;
  /** Real per-user read state from control.NotificationRecipient (backend-persisted, not client-only). */
  isRead: boolean;
  /** Route to navigate to on click, if any (already resolved by the source service). */
  route?: string;
}

/** Common poll result shape every NotificationSource must return. */
export interface NotificationsFeed {
  unseenCount: number;
  items: NotificationItem[];
}
