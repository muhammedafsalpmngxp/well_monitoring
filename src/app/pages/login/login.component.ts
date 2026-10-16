import { Component, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { landingForRole } from '../../features/landing/landing';

/**
 * Sign-in page (Al Tasnim Maps). Front-end demo auth — the role is inferred
 * from the email (admin → Admin, sujith → Site MGT). On submit the user is
 * signed in via AuthService and routed into the app.
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class LoginComponent {

  email = '';
  password = '';
  remember = false;
  showPass = false;

  constructor(private auth: AuthService, private router: Router) {}

  toggleShow(): void { this.showPass = !this.showPass; }

  submit(): void {
    const user = this.auth.login(this.email.trim());
    // Sync the topbar role selector to the signed-in user (admin → Admin,
    // Sujith → Site MGT).
    const w = window as any;
    if (typeof w.applyAuthRole === 'function') w.applyAuthRole();
    // Land on the page the admin configured for this role (else Standard Boards).
    const landing = landingForRole(user.role);
    this.router.navigateByUrl('/' + (landing?.route || 'standardboards'));
    // Dashboards that open as a dvs board on /cmdoverview.
    if (landing?.dvsId != null) {
      setTimeout(() => { try { w.dvsOpenBoard?.(landing.dvsId); } catch { /* noop */ } }, 500);
    }
  }
}
