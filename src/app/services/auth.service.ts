import { Injectable } from '@angular/core';

export interface AuthUser {
  name: string;
  email: string;
  role: string;
}

const KEY = 'smartops.auth.user';

/**
 * Front-end demo authentication.
 *
 * No backend — the role is inferred from the email entered on the login page:
 *   • contains "admin"  → Admin user
 *   • contains "sujith" → Sujith (Site MGT)
 *   • anything else     → a generic Viewer (so the page still works)
 * The signed-in user is persisted in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {

  private user: AuthUser | null = null;

  constructor() {
    try { this.user = JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch { this.user = null; }
    try { (window as any).__currentUser = this.user; } catch { /* noop */ }
  }

  get currentUser(): AuthUser | null { return this.user; }
  isAuthenticated(): boolean { return !!this.user; }

  /** Resolve a role from the email and sign the user in. */
  login(email: string): AuthUser {
    const e = (email || '').toLowerCase();
    let user: AuthUser;
    if (e.includes('admin')) {
      user = { name: 'Admin User', email, role: 'Admin' };
    } else if (e.includes('sujith')) {
      user = { name: 'Sujith', email, role: 'Site MGT' };
    } else {
      const handle = (email || '').split('@')[0] || 'User';
      user = { name: handle.charAt(0).toUpperCase() + handle.slice(1), email, role: 'Viewer' };
    }
    this.user = user;
    try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* noop */ }
    try { (window as any).__currentUser = user; } catch { /* noop */ }
    return user;
  }

  logout(): void {
    this.user = null;
    try { localStorage.removeItem(KEY); } catch { /* noop */ }
    try { (window as any).__currentUser = null; } catch { /* noop */ }
  }
}
