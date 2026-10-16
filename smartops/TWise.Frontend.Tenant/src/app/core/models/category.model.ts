/** Matches backend CategoryDropdownResponse */
export interface CategoryDropdown {
  categoryId: number;
  categoryName: string;
  description?: string;
  controlType?: string;
  itemCount?: number;
}

/** Matches backend CategoryResponse (returned after create/update) */
export interface CategoryResponse {
  categoryId: number;
  categoryName: string;
  description?: string;
  controlType?: string;
  message: string;
}

/** Matches backend SaveCategoryRequest (used for create & update) */
export interface SaveCategoryRequest {
  categoryName: string;
  description?: string;
  controlType: string;
}
