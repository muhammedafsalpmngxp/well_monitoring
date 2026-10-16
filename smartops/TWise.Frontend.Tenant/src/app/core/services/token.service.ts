import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import { APP_CONSTANTS } from '../constants/app.constants';

@Injectable({ providedIn: 'root' })
export class TokenService {
  constructor(private readonly storageService: StorageService) {}

  getAccessToken(): string | null {
    return this.storageService.getItem(APP_CONSTANTS.STORAGE_KEYS.ACCESS_TOKEN);
  }

  setAccessToken(token: string): void {
    this.storageService.setItem(APP_CONSTANTS.STORAGE_KEYS.ACCESS_TOKEN, token);
  }

  getRefreshToken(): string | null {
    return this.storageService.getItem(APP_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN);
  }

  setRefreshToken(token: string): void {
    this.storageService.setItem(APP_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN, token);
  }

  clearTokens(): void {
    this.storageService.removeItem(APP_CONSTANTS.STORAGE_KEYS.ACCESS_TOKEN);
    this.storageService.removeItem(APP_CONSTANTS.STORAGE_KEYS.REFRESH_TOKEN);
  }
}
