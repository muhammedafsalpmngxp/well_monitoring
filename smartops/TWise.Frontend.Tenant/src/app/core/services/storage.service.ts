import { Injectable } from '@angular/core';

/** Safe wrapper around localStorage — handles exceptions in restricted contexts. */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly sessionFallback = new Map<string, string>();

  getSessionItem(key: string): string | null {
    try {
      return sessionStorage.getItem(key) ?? this.sessionFallback.get(key) ?? null;
    } catch {
      return this.sessionFallback.get(key) ?? null;
    }
  }

  setSessionItem(key: string, value: string): boolean {
    try {
      sessionStorage.setItem(key, value);
      this.sessionFallback.delete(key);
      return true;
    } catch {
      this.sessionFallback.set(key, value);
      return false;
    }
  }

  clearSessionItems(prefix: string): void {
    for (const key of this.sessionFallback.keys()) {
      if (key.startsWith(prefix)) this.sessionFallback.delete(key);
    }
    try {
      const keys = Object.keys(sessionStorage).filter(key => key.startsWith(prefix));
      keys.forEach(key => sessionStorage.removeItem(key));
    } catch {
      return;
    }
  }

  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (e.g., private browsing, storage full)
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable
    }
  }

  clear(): void {
    try {
      localStorage.clear();
    } catch {
      // Storage unavailable
    }
  }
}
