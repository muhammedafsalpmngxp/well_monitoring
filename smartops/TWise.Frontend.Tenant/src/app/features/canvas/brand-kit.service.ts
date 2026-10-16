import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiResponse } from '../../core/models/api-response.model';
import { BrandKit, readBrandKit } from './canvas-style.util';

/** A saved brand kit: its name and the kit, checked as a canvas checks the kit it keeps. */
export interface SavedBrandKit { id: number; name: string; kit: BrandKit; }

/** The tenant's saved brand kits (GET, POST, PUT and DELETE /api/canvas/brand-kits). */
@Injectable({ providedIn: 'root' })
export class BrandKitService {
  private readonly base = `${environment.tenantApiUrl}/canvas/brand-kits`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<SavedBrandKit[]> {
    return this.http.get<ApiResponse<{ id: number; name: string; kit: unknown }[]>>(this.base)
      .pipe(map(response => response.data.map(saved => this.read(saved))));
  }

  create(name: string, kit: BrandKit): Observable<SavedBrandKit> {
    return this.http.post<ApiResponse<{ id: number; name: string; kit: unknown }>>(this.base, { name, kit: stored(kit) })
      .pipe(map(response => this.read(response.data)));
  }

  update(id: number, name: string, kit: BrandKit): Observable<SavedBrandKit> {
    return this.http.put<ApiResponse<{ id: number; name: string; kit: unknown }>>(`${this.base}/${id}`, { name, kit: stored(kit) })
      .pipe(map(response => this.read(response.data)));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  private read(saved: { id: number; name: string; kit: unknown }): SavedBrandKit {
    return { id: saved.id, name: saved.name, kit: readBrandKit(saved.kit) ?? {} };
  }
}

/** The kit as saved: without the note of which saved kit a canvas copied it from. */
function stored(kit: BrandKit): BrandKit {
  const { kitId: _id, kitName: _name, ...rest } = kit;
  return rest;
}
