import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { ForgotPasswordComponent } from './forgot-password/forgot-password.component';
import { ROUTES } from '../core/constants/route.constants';

const routes: Routes = [
  { path: '',                          redirectTo: ROUTES.AUTH.LOGIN, pathMatch: 'full' },
  { path: ROUTES.AUTH.LOGIN,           component: LoginComponent },
  { path: ROUTES.AUTH.FORGOT_PASSWORD, component: ForgotPasswordComponent },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuthRoutingModule {}
