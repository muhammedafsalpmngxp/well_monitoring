import { Directive, Input, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

/** Structural directive — shows content only if the current user has the required role(s). */
@Directive({ selector: '[appHasRole]', standalone: false })
export class HasRoleDirective implements OnInit {
  @Input() appHasRole: string | string[] = [];

  constructor(
    private templateRef: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private authService: AuthService,
  ) {}

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    const rawRole = (user?.role || '').toLowerCase();
    // Map generic/custom role names to system roles
    const role = rawRole === 'user' ? 'viewer' : rawRole;
    const required = Array.isArray(this.appHasRole) ? this.appHasRole : [this.appHasRole];
    const hasRole = !!role && required.map(r => r.toLowerCase()).includes(role);

    if (hasRole) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else {
      this.viewContainer.clear();
    }
  }
}
