import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';
import { ImportedDatasetDto } from './imported-dataset.service';

/** Connector kinds supported by the Tenant API (pull-based sources). */
export type DataSourceKind = 'google_sheets' | 'google_drive' | 'rest_api';

/** SQL engines queried live through the View Builder. */
export type SqlProvider = 'mssql' | 'postgres' | 'mysql' | 'mariadb' | 'redshift' | 'clickhouse' | 'trino';

/** Every source type the Data Sources page can create, across both families. */
export type AnySourceType = DataSourceKind | SqlProvider;

export const SQL_PROVIDERS: SqlProvider[] = ['mssql', 'postgres', 'mysql', 'mariadb', 'redshift', 'clickhouse', 'trino'];

export const SQL_PROVIDER_LABELS: Record<SqlProvider, string> = {
  mssql: 'SQL Server',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  redshift: 'Amazon Redshift',
  clickhouse: 'ClickHouse (HTTP)',
  trino: 'Trino / Presto (HTTP)',
};

export const SQL_PROVIDER_DEFAULT_PORTS: Record<SqlProvider, number> = {
  mssql: 1433,
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  redshift: 5439,
  clickhouse: 8123,
  trino: 8080,
};

export function isSqlProvider(value: string): value is SqlProvider {
  return (SQL_PROVIDERS as string[]).includes(value);
}

/** A live SQL database connection (core.DatabaseConnections). */
export interface SqlConnection {
  id: number;
  connectionName: string;
  server: string;
  port: number;
  databaseName: string;
  username: string;
  provider: SqlProvider;
  trustServerCertificate: boolean;
  isActive: boolean;
  createdAt: string;
  modifiedAt: string;
}

export interface CreateSqlConnectionRequest {
  connectionName: string;
  server: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  provider: SqlProvider;
  trustServerCertificate: boolean;
}

export interface UpdateSqlConnectionRequest extends Omit<CreateSqlConnectionRequest, 'password'> {
  /** Leave blank to keep the stored password. */
  password?: string | null;
  isActive: boolean;
}

/** Result of syncing a connection's schema — used as the SQL equivalent of a connectivity test. */
export interface SqlSchemaResponse {
  connectionId: number;
  connectionName: string;
  databaseName: string;
  syncedAt: string;
  tables: { schemaName: string; tableName: string; columnCount: number }[];
}

export type DataSourceAuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2';

export interface DataSourceConnection {
  id: number;
  connectionName: string;
  kind: DataSourceKind;
  authType: DataSourceAuthType;
  /** Whether secrets are stored. The values themselves are never returned. */
  hasCredentials: boolean;
  configJson: string;
  lastStatus?: string | null;
  lastErrorMessage?: string | null;
  lastTestedAt?: string | null;
  isActive: boolean;
  createdAt: string;
  modifiedAt: string;
}

export interface DataSourceConfigField {
  name: string;
  label: string;
  fieldType: 'text' | 'password' | 'number' | 'textarea' | 'select' | 'keyvalue';
  required: boolean;
  /** True when the value belongs in `credentials` rather than `config`. */
  secret: boolean;
  placeholder?: string | null;
  helpText?: string | null;
  /** Choices for a 'select' field; the first is the default. */
  options?: string[] | null;
}

export interface DataSourceKindOption {
  kind: DataSourceKind;
  label: string;
  description: string;
  supportedAuthTypes: DataSourceAuthType[];
  configFields: DataSourceConfigField[];
}

export interface DataSourceOptions {
  kinds: DataSourceKindOption[];
  authTypes: DataSourceAuthType[];
  /** SQL engines available on /api/database-connections — mssql, postgres, mysql. */
  sqlProviders: string[];
}

export interface DataSourceTestResult {
  success: boolean;
  message: string;
  objectCount?: number | null;
  testedAt: string;
}

export interface DataSourceObject {
  ref: string;
  name: string;
  objectType: string;
  sizeBytes?: number | null;
}

export interface CreateDataSourceRequest {
  connectionName: string;
  kind: DataSourceKind;
  authType: DataSourceAuthType;
  config?: Record<string, unknown> | null;
  credentials?: Record<string, string> | null;
}

export interface UpdateDataSourceRequest {
  connectionName: string;
  authType: DataSourceAuthType;
  config?: Record<string, unknown> | null;
  /** Omit to keep the stored secrets — sending {} would clear them. */
  credentials?: Record<string, string> | null;
  isActive: boolean;
}

/**
 * Pull-based external data sources: Google Sheets, Google Drive and REST APIs.
 *
 * These are fetched on demand and materialised into Imported Datasets, which is what
 * charts and tiles actually read (sourceType 'Import'). For live SQL sources use the
 * database-connections endpoints instead.
 */
@Injectable({ providedIn: 'root' })
export class DataSourceService {
  constructor(private readonly http: HttpClient) {}

  private get baseUrl(): string {
    return `${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.BASE}`;
  }

  getOptions(): Observable<DataSourceOptions> {
    return this.http.get<DataSourceOptions>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.OPTIONS}`);
  }

  list(): Observable<DataSourceConnection[]> {
    return this.http.get<DataSourceConnection[]>(this.baseUrl);
  }

  getById(id: number): Observable<DataSourceConnection> {
    return this.http.get<DataSourceConnection>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.BY_ID(id)}`);
  }

  create(request: CreateDataSourceRequest): Observable<DataSourceConnection> {
    return this.http.post<DataSourceConnection>(this.baseUrl, request);
  }

  update(id: number, request: UpdateDataSourceRequest): Observable<DataSourceConnection> {
    return this.http.put<DataSourceConnection>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.BY_ID(id)}`, request);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.BY_ID(id)}`);
  }

  /** A failed test returns 200 with success=false — check the flag, not the HTTP status. */
  test(id: number): Observable<DataSourceTestResult> {
    return this.http.post<DataSourceTestResult>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.TEST(id)}`, {});
  }

  listObjects(id: number): Observable<DataSourceObject[]> {
    return this.http.get<DataSourceObject[]>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.OBJECTS(id)}`);
  }

  /** Fetches the object and stores it as a dataset usable as a chart/tile source. */
  ingest(id: number, objectRef?: string | null, datasetName?: string | null): Observable<ImportedDatasetDto> {
    return this.http.post<ImportedDatasetDto>(
      `${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.INGEST(id)}`,
      { objectRef: objectRef ?? null, datasetName: datasetName ?? null },
    );
  }

  // ── Live SQL databases (/api/database-connections) ────────────────────────
  //
  // A different endpoint and a different family: these are queried live by the View
  // Builder rather than ingested. They share this page so users have one place to add
  // any source, which is what the Data Sources screen is expected to offer.

  listSqlConnections(): Observable<SqlConnection[]> {
    return this.http.get<SqlConnection[]>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATABASE_CONNECTIONS.BASE}`);
  }

  createSqlConnection(request: CreateSqlConnectionRequest): Observable<SqlConnection> {
    return this.http.post<SqlConnection>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATABASE_CONNECTIONS.BASE}`, request);
  }

  updateSqlConnection(id: number, request: UpdateSqlConnectionRequest): Observable<SqlConnection> {
    return this.http.put<SqlConnection>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATABASE_CONNECTIONS.BY_ID(id)}`, request);
  }

  deleteSqlConnection(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATABASE_CONNECTIONS.BY_ID(id)}`);
  }

  /**
   * Re-discovers tables and columns on the remote server. This doubles as the
   * connectivity test for a SQL source — it fails loudly if the server is unreachable.
   */
  syncSqlSchema(id: number): Observable<SqlSchemaResponse> {
    return this.http.post<SqlSchemaResponse>(`${environment.tenantApiUrl}${API_ENDPOINTS.DATABASE_CONNECTIONS.SYNC(id)}`, {});
  }

  /** Returns the Google consent URL to open; it does not navigate. */
  startGoogleAuth(connectionId: number, includeDrive: boolean): Observable<{ authorizationUrl: string }> {
    const url = `${environment.tenantApiUrl}${API_ENDPOINTS.DATA_SOURCES.GOOGLE_AUTH_START}`
      + `?connectionId=${connectionId}&includeDrive=${includeDrive}`;
    return this.http.get<{ authorizationUrl: string }>(url);
  }
}
