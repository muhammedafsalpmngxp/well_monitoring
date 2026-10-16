import { Injectable, signal } from '@angular/core';
import { TokenService } from './token.service';

export type PermissionAction = 'v' | 'c' | 'm' | 'a';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly permissions = signal<Map<string, string>>(new Map());
  private isAdmin = false;

  get isAdminUser(): boolean { return this.isAdmin; }

  constructor(private readonly tokenService: TokenService) {}

  loadFromToken(): void {
    const token = this.tokenService.getAccessToken();
    if (!token) {
      this.isAdmin = false;
      this.permissions.set(new Map());
      return;
    }

    try {
      const encodedPayload = token.split('.')[1];
      if (!encodedPayload) throw new Error('Invalid JWT payload');
      const base64Payload = encodedPayload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
      const payload = JSON.parse(atob(base64Payload));

      // Admin role has full access — no need to check individual permissions
      const role = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
                || payload['role'] || '';
      this.isAdmin = role.toLowerCase() === 'admin';

      const permMap = new Map<string, string>();
      const permClaims = payload['perm'];
      if (Array.isArray(permClaims)) {
        for (const p of permClaims) {
          const [code, flags] = p.split(':');
          if (code && flags) permMap.set(code, flags);
        }
      } else if (typeof permClaims === 'string') {
        const [code, flags] = permClaims.split(':');
        if (code && flags) permMap.set(code, flags);
      }

      this.permissions.set(permMap);
    } catch {
      this.isAdmin = false;
      this.permissions.set(new Map());
    }
  }

  hasPermission(moduleCode: string, action: PermissionAction = 'v'): boolean {
    if (this.isAdmin) return true;
    return this.permissions().get(moduleCode)?.includes(action) ?? false;
  }

  canView(moduleCode: string): boolean {
    return this.hasPermission(moduleCode, 'v');
  }

  canCreate(moduleCode: string): boolean {
    return this.hasPermission(moduleCode, 'c');
  }

  canModify(moduleCode: string): boolean {
    return this.hasPermission(moduleCode, 'm');
  }

  canAdmin(moduleCode: string): boolean {
    return this.hasPermission(moduleCode, 'a');
  }

  getViewableModuleCodes(): string[] {
    return [...this.permissions().entries()]
      .filter(([, flags]) => flags.includes('v'))
      .map(([code]) => code);
  }

  /** Count of modules the current user actually holds a permission for. */
  get grantedModuleCount(): number {
    return this.permissions().size;
  }

  /**
   * Overall access label for the logged-in user, aggregated across all module
   * permissions: Full Access (admin) > Write Access (create/modify) > View Access.
   */
  get accessLevelLabel(): string {
    if (this.isAdmin) return 'Full Access';

    const flagsList = [...this.permissions().values()];
    if (!flagsList.length) return 'No Access';

    if (flagsList.some((flags) => flags.includes('a'))) return 'Full Access';
    if (flagsList.some((flags) => flags.includes('c') || flags.includes('m'))) return 'Write Access';
    if (flagsList.some((flags) => flags.includes('v'))) return 'View Access';
    return 'No Access';
  }

  clear(): void {
    this.isAdmin = false;
    this.permissions.set(new Map());
  }
}
