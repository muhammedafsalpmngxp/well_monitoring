import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';

export interface LearnChapterDto {
  id: string;
  label: string;
  /** Seconds into the video. */
  time: number;
  durationLabel: string;
}

/** The Learn video for one screen; the MP4 is served from object storage (S3). */
export interface LearnVideoDto {
  screenKey: string;
  title: string;
  videoUrl: string;
  posterUrl?: string | null;
  chapters: LearnChapterDto[];
  isActive?: boolean;
  modifiedAt?: string | null;
}

export interface SaveLearnVideoRequest {
  title: string;
  videoUrl: string;
  posterUrl?: string | null;
  chapters: LearnChapterDto[];
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class LearnVideoService {
  constructor(private readonly http: HttpClient) {}

  private get base(): string {
    return `${environment.tenantApiUrl}${API_ENDPOINTS.LEARN_VIDEOS.BASE}`;
  }

  /** 404 when no video is configured for the screen — callers keep their built-in fallback. */
  get(screenKey: string): Observable<LearnVideoDto> {
    return this.http.get<LearnVideoDto>(`${environment.tenantApiUrl}${API_ENDPOINTS.LEARN_VIDEOS.BY_SCREEN(screenKey)}`);
  }

  /** Admin: every configured video. */
  list(): Observable<LearnVideoDto[]> {
    return this.http.get<LearnVideoDto[]>(this.base);
  }

  /** Admin: create or replace the video for a screen. */
  save(screenKey: string, request: SaveLearnVideoRequest): Observable<LearnVideoDto> {
    return this.http.put<LearnVideoDto>(`${environment.tenantApiUrl}${API_ENDPOINTS.LEARN_VIDEOS.BY_SCREEN(screenKey)}`, request);
  }
}
