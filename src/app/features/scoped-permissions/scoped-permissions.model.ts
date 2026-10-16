/**
 * Scoped role assignment (Option A) — data model.
 *
 * A role stays a single, scope-agnostic permission template. The *assignment*
 * of a role to a user carries a hierarchical scope (Cluster → Site → Plant/Well).
 * The same role therefore resolves to different effective access depending on
 * where in the hierarchy the user is granted it.
 *
 * Demo/front-end only — no API. Everything here is mock data exercised by
 * ScopedPermissionsService.
 */

export type PermType = 'view' | 'modify' | 'execute';

export interface PermSet {
  view: boolean;
  modify: boolean;
  execute: boolean;
}

/** A permission subject (module the role grants access to). */
export interface PermModule {
  id: string;
  name: string;
}

/** Levels of the scope hierarchy. Leaf ('plant') covers Plant / Well. */
export type ScopeLevel = 'ALL' | 'cluster' | 'site' | 'plant';

/**
 * A node in the scope tree. `key` is the canonical path used for inheritance:
 *   '*'  ·  'NIMR'  ·  'NIMR/Coastal'  ·  'NIMR/Coastal/W-34565'
 * A grant at an ancestor key covers every descendant (prefix match).
 */
export interface ScopeNode {
  key: string;
  label: string;
  level: ScopeLevel;
  children?: ScopeNode[];
}

/** A reusable, scope-agnostic permission template. */
export interface RoleDef {
  id: string;
  name: string;
  description: string;
  color: string;
  /** moduleId → permissions granted by this role. */
  permissions: Record<string, PermSet>;
}

/** The user↔role binding — this is where scope lives (Option A). */
export interface RoleAssignment {
  roleId: string;
  /** One or more scope node keys this role is granted at for the user. */
  scopeKeys: string[];
}

export interface DemoUser {
  id: number;
  name: string;
  email: string;
  assignments: RoleAssignment[];
}

/** One grant that contributed to a resolved permission set. */
export interface Contributor {
  roleId: string;
  roleName: string;
  roleColor: string;
  scopeKey: string;
  scopeLabel: string;
}

/** Result of resolving a user's access at a given active scope. */
export interface Resolved {
  /** moduleId → effective (unioned) permissions at the active scope. */
  perms: Record<string, PermSet>;
  /** Which role@scope grants applied (and therefore contributed). */
  contributors: Contributor[];
  /** True when at least one grant covers the active scope. */
  hasAny: boolean;
}
