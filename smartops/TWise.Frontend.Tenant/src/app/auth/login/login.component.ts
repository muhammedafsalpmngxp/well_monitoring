import { Component, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { EMPTY, catchError, finalize, from, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { RouteLoadingService } from '../../core/services/route-loading.service';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  readonly isLoading = signal(false);
  readonly isNavigating = signal(false);
  readonly errorMessage = signal('');
  showPass = false;

  constructor(
    private readonly fb: FormBuilder,
    private readonly authService: AuthService,
    private readonly routeLoading: RouteLoadingService,
  ) {}

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      email:        ['', [Validators.required, Validators.email]],
      password:     ['', [Validators.required, Validators.minLength(6)]],
      keepSignedIn: [false],
    });
  }

  get email()    { return this.loginForm.get('email'); }
  get password() { return this.loginForm.get('password'); }

  toggleShow(): void { this.showPass = !this.showPass; }

  onSubmit(): void {
    if (this.isLoading() || this.isNavigating()) return;

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.isLoading.set(true);
    this.errorMessage.set('');

    const { email, password } = this.loginForm.value;
    this.authService.login({ email, password }).pipe(
      switchMap(() => {
        this.isLoading.set(false);
        this.isNavigating.set(true);
        return from(this.routeLoading.navigateAfterLogin()).pipe(
          catchError(() => {
            this.errorMessage.set('Signed in, but the dashboard could not be opened. Please try again.');
            return EMPTY;
          }),
        );
      }),
      finalize(() => {
        this.isLoading.set(false);
        this.isNavigating.set(false);
      }),
    ).subscribe({
      next: navigated => {
        if (!navigated) {
          this.errorMessage.set('Dashboard navigation was cancelled. Please try again.');
        }
      },
      error: (err: any) => {
        this.errorMessage.set(err?.error?.message || 'Login failed. Please try again.');
      },
    });
  }
}
