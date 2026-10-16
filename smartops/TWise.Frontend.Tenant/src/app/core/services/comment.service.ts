import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type CommentTargetType = 'Dashboard' | 'Report' | 'Widget' | 'Canvas';

export interface CommentDto {
  commentId: number;
  parentCommentId: number | null;
  userId: number;
  authorDisplayName: string;
  body: string;
  mentionedUserIds: number[];
  createdAt: string;
  replies: CommentDto[];
}

export interface CreateCommentRequest {
  targetType: CommentTargetType;
  targetId: number;
  parentCommentId?: number | null;
  body: string;
  mentionedUserIds?: number[];
}

@Injectable({ providedIn: 'root' })
export class CommentService {
  // CommentController returns raw DTOs (no ApiEnvelope wrapper, like UserPreferenceController) —
  // use HttpClient directly instead of ApiService, which expects the enveloped {data,...} shape.
  private readonly baseUrl = `${environment.tenantApiUrl}/comments`;

  constructor(private readonly http: HttpClient) {}

  getThread(targetType: CommentTargetType, targetId: number): Observable<CommentDto[]> {
    const params = new HttpParams().set('targetType', targetType).set('targetId', targetId);
    return this.http.get<CommentDto[]>(this.baseUrl, { params });
  }

  create(request: CreateCommentRequest): Observable<CommentDto> {
    return this.http.post<CommentDto>(this.baseUrl, request);
  }

  delete(commentId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${commentId}`);
  }
}
