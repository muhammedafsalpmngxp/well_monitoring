import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpParams } from '@angular/common/http';
import { ApiService } from './api.service';
import { CategoryDropdown, CategoryResponse, SaveCategoryRequest } from '../models/category.model';
import { ApiResponse } from '../models/api-response.model';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly path = '/category';

  /** Reactive category list – auto-refreshes after CRUD operations. */
  private readonly categoriesSubject = new BehaviorSubject<CategoryDropdown[]>([]);
  readonly categories$ = this.categoriesSubject.asObservable();

  private loaded = false;
  private loading = false;

  constructor(private readonly api: ApiService) {}

  /** Load categories from backend (GET /api/category). */
  loadCategories(): Observable<CategoryDropdown[]> {
    return this.api.get<CategoryDropdown[]>(this.path).pipe(
      map((res: ApiResponse<CategoryDropdown[]>) => res.data ?? []),
      tap((categories) => {
        this.categoriesSubject.next(categories);
        this.loaded = true;
        this.loading = false;
      }),
    );
  }

  /** Get categories – loads once from API, then returns cache reactively. */
  getCategories(): Observable<CategoryDropdown[]> {
    if (!this.loaded && !this.loading) {
      this.loading = true;
      this.loadCategories().subscribe({
        error: () => { this.loading = false; },
      });
    }
    return this.categories$;
  }

  /** Get categories filtered by controlType (dashboard, chart, tile, report). */
  getCategoriesByType(controlType: string): Observable<CategoryDropdown[]> {
    const params = new HttpParams().set('controlType', controlType);
    return this.api.get<CategoryDropdown[]>(this.path, params).pipe(
      map((res: ApiResponse<CategoryDropdown[]>) => res.data ?? []),
    );
  }

  getManagedCategoriesByType(controlType: string): Observable<CategoryDropdown[]> {
    const params = new HttpParams().set('controlType', controlType);
    return this.api.get<CategoryDropdown[]>(`${this.path}/manage`, params).pipe(
      map((res: ApiResponse<CategoryDropdown[]>) => res.data ?? []),
    );
  }

  /** Get categories as a simple string array of names (for legacy dropdowns). */
  getCategoryNames(): Observable<string[]> {
    return this.getCategories().pipe(
      map((cats) => cats.map((c) => c.categoryName)),
    );
  }

  /** Create a new category (POST /api/category). */
  createCategory(request: SaveCategoryRequest): Observable<ApiResponse<CategoryResponse>> {
    return this.api.post<CategoryResponse>(this.path, request).pipe(
      tap(() => this.refresh()),
    );
  }

  /** Update an existing category (PUT /api/category/:id). */
  updateCategory(categoryId: number, request: SaveCategoryRequest): Observable<ApiResponse<CategoryResponse>> {
    return this.api.put<CategoryResponse>(`${this.path}/${categoryId}`, request).pipe(
      tap(() => this.refresh()),
    );
  }

  /** Delete a category (DELETE /api/category/:id). */
  deleteCategory(categoryId: number): Observable<ApiResponse<void>> {
    return this.api.delete<void>(`${this.path}/${categoryId}`).pipe(
      tap(() => this.refresh()),
    );
  }

  refresh(): void {
    this.loadCategories().subscribe({ error: () => {} });
  }

  /** Reset cached category list (call on logout so the next user starts fresh). */
  clearCache(): void {
    this.categoriesSubject.next([]);
    this.loaded = false;
    this.loading = false;
  }
}
