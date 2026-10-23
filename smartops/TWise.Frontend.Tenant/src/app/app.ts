import { Component, ErrorHandler, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GlobalErrorHandlerService } from './core/services/global-error-handler.service';
import { SessionRefreshService } from './core/services/session-refresh.service';
import { RouteLoadingService } from './core/services/route-loading.service';
import { SharedModule } from './shared/shared.module';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SharedModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  readonly errorHandler = inject(ErrorHandler) as GlobalErrorHandlerService;
  readonly routeLoading = inject(RouteLoadingService);

  constructor() {
    inject(SessionRefreshService).startMonitoring();
  }
}
