import { Component } from '@angular/core';
import {
  ColDef, ModuleRegistry, ClientSideRowModelModule, themeQuartz,
  RowSelectionModule, RowSelectionOptions, SelectionColumnDef,
} from 'ag-grid-community';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

export interface ActivityRow {
  run: string;
  agent: string;
  inputSummary: string;
  verdict: string;
  duration: string;
  started: string;
  status: string;
}

export interface FilterChip {
  key: string;
  label: string;
}

const ACT_GRID_THEME = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#dfe6e9',
  borderRadius: 8,
  checkboxBorderRadius: 4,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#ffffff',
  headerTextColor: '#344054',
  headerFontWeight: 600,
  rowHoverColor: '#F5F8FF',
  selectedRowBackgroundColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

const ALL_ROWS: ActivityRow[] = Array.from({ length: 8618 }, (_, i) => {
  const agents = [
    'Well Delay Predictor', 'maya.roy@acme.com', 'john.smith@acme.com',
    'Anomaly Detector', 'Report Generator', 'Forecast Agent',
  ];
  const verdicts = [
    'Delayed {8d,0.86}', '{"well_id:GNR-221"}', 'On Track {3d,0.91}',
    'Anomaly Detected', 'Failed-well not found', 'Normal',
  ];
  const statuses = ['Success', 'Success', 'Success', 'Success', 'Success', 'Error'];
  const idx = i % 6;
  return {
    run: 'R-' + (2086 + Math.floor(i / 6)),
    agent: agents[idx],
    inputSummary: '{"well_id:GNR-' + (200 + (i % 50)) + '"}',
    verdict: verdicts[idx],
    duration: (1.8 + (i % 7) * 0.3).toFixed(2) + 's',
    started: '26-Apr-26, 06:00',
    status: statuses[idx],
  };
});

@Component({
  selector: 'app-activity-log',
  standalone: false,
  templateUrl: './activity-log.component.html',
  styleUrls: ['./activity-log.component.scss'],
})
export class ActivityLogComponent {
  gridTheme = ACT_GRID_THEME;

  // ── Filter Panel ───────────────────────────────────────
  showFilterPanel = true;
  filterPinned = false;

  filterCountryOptions = ['UAE', 'Oman', 'Saudi Arabia'];
  filterCountry = 'UAE';

  filterSectorOptions = ['Industrial', 'Commercial', 'Residential'];
  filterSector = 'Industrial';

  filterBusinessUnitOptions = ['Upstream', 'Downstream', 'Midstream'];
  filterBusinessUnit = '';

  filterDivisionOptions = ['Division A', 'Division B', 'Division C'];
  filterDivision = '';

  filterClusterOptions = ['Marmul', 'Nimr', 'Rima'];
  filterCluster = '';

  filterPlantOptions = ['Plant 1', 'Plant 2', 'Plant 3'];
  filterPlant = '';

  filterFrom = '12-12-2026';
  filterTo = '12-12-2026';

  filterQuickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'This Quarter', 'This Year', 'After', 'Custom'];
  filterQuickRange = '';

  searchTerm = '';

  /** Snap a date to the last Tuesday on or before it (mm-dd-yyyy string). */
  private lastTuesday(date: Date): string {
    const d = new Date(date);
    const diff = (d.getDay() + 5) % 7;
    d.setDate(d.getDate() - diff);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  }

  onQuickRangeChange(range: string): void {
    this.filterQuickRange = range;
    const today = new Date();
    const mdy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
    switch (range) {
      case 'Today':
        this.filterFrom = mdy(today);
        this.filterTo = mdy(today);
        break;
      case 'Till Last Tuesday':
        this.filterFrom = mdy(new Date(today.getFullYear(), 0, 1));
        this.filterTo = this.lastTuesday(today);
        break;
      case 'This Week': {
        const d = new Date(today);
        d.setDate(d.getDate() - d.getDay());
        this.filterFrom = mdy(d);
        this.filterTo = mdy(today);
        break;
      }
      case 'This Month':
        this.filterFrom = mdy(new Date(today.getFullYear(), today.getMonth(), 1));
        this.filterTo = mdy(today);
        break;
      case 'This Quarter': {
        const qm = Math.floor(today.getMonth() / 3) * 3;
        this.filterFrom = mdy(new Date(today.getFullYear(), qm, 1));
        this.filterTo = mdy(today);
        break;
      }
      case 'This Year':
        this.filterFrom = mdy(new Date(today.getFullYear(), 0, 1));
        this.filterTo = mdy(today);
        break;
      case 'After':
        this.filterTo = '';
        break;
    }
  }

  get activeFilterChips(): FilterChip[] {
    const chips: FilterChip[] = [];
    if (this.filterCountry)      chips.push({ key: 'country',  label: 'Country: ' + this.filterCountry });
    if (this.filterSector)       chips.push({ key: 'sector',   label: 'Sector: ' + this.filterSector + ' Project' });
    if (this.filterBusinessUnit) chips.push({ key: 'bu',       label: 'Business Unit: ' + this.filterBusinessUnit });
    if (this.filterDivision)     chips.push({ key: 'division', label: 'Division: ' + this.filterDivision });
    if (this.filterCluster)      chips.push({ key: 'cluster',  label: 'Cluster: ' + this.filterCluster });
    if (this.filterPlant)        chips.push({ key: 'plant',    label: 'Plant: ' + this.filterPlant });
    return chips;
  }

  toggleFilterPanel(): void {
    if (!this.filterPinned) this.showFilterPanel = !this.showFilterPanel;
  }

  togglePin(): void {
    this.filterPinned = !this.filterPinned;
    if (this.filterPinned) this.showFilterPanel = true;
  }

  removeFilterChip(key: string): void {
    switch (key) {
      case 'country':  this.filterCountry = '';       break;
      case 'sector':   this.filterSector = '';        break;
      case 'bu':       this.filterBusinessUnit = '';  break;
      case 'division': this.filterDivision = '';      break;
      case 'cluster':  this.filterCluster = '';       break;
      case 'plant':    this.filterPlant = '';         break;
    }
  }

  // ── Grid ───────────────────────────────────────────────
  readonly rowSelection: RowSelectionOptions<ActivityRow> = {
    mode: 'multiRow',
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: false,
  };

  readonly selectionColumnDef: SelectionColumnDef = {
    width: 48,
    maxWidth: 48,
    minWidth: 48,
    suppressHeaderMenuButton: true,
    suppressMovable: true,
  };

  columnDefs: ColDef<ActivityRow>[] = [
    { field: 'run', headerName: 'Run', flex: 0.8, minWidth: 90 },
    { field: 'agent',        headerName: 'Agent',         flex: 1.4, minWidth: 160 },
    { field: 'inputSummary', headerName: 'Input Summary', flex: 1.4, minWidth: 160 },
    {
      field: 'verdict', headerName: 'Verdict', flex: 1.4, minWidth: 160,
      cellRenderer: (p: { value: string }) => {
        const failed = p.value?.toLowerCase().includes('failed') || p.value?.toLowerCase().includes('error');
        const color = failed ? '#C62828' : 'inherit';
        return `<span style="color:${color}">${p.value ?? ''}</span>`;
      },
    },
    { field: 'duration', headerName: 'Duration', flex: 0.8, minWidth: 90 },
    { field: 'started',  headerName: 'Started',  flex: 1.2, minWidth: 140 },
    {
      field: 'status', headerName: 'Status', flex: 0.9, minWidth: 120,
      cellRenderer: (p: { value: string }) => {
        const isError = p.value === 'Error';
        const bg     = isError ? '#FDECEC' : '#EEF8EE';
        const border = isError ? '#F8C7C6' : '#D8F4D9';
        const color  = isError ? '#C62828' : '#1B7A3A';
        return `<span style="display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:20px;border:1px solid ${border};background:${bg};font-size:12px;font-weight:500;color:${color}">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;"></span>
          ${p.value}
        </span>`;
      },
    },
  ];

  defaultColDef: ColDef = { sortable: true, resizable: true, suppressMovable: true };

  // ── Pagination ─────────────────────────────────────────
  readonly totalRecords = ALL_ROWS.length;
  readonly pageSize = 20;
  currentPage = 1;

  get totalPages(): number { return Math.ceil(this.totalRecords / this.pageSize); }

  get pagedRows(): ActivityRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return ALL_ROWS.slice(start, start + this.pageSize);
  }

  get paginationInfo(): string {
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(this.currentPage * this.pageSize, this.totalRecords);
    return `${start} to ${end} of ${this.totalRecords.toLocaleString()}`;
  }

  firstPage(): void { this.currentPage = 1; }
  prevPage(): void  { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void  { if (this.currentPage < this.totalPages) this.currentPage++; }
  lastPage(): void  { this.currentPage = this.totalPages; }
}

