import { Component, HostListener } from '@angular/core';

export interface AppUser {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Plant-access codes granted to the user (e.g. ['3522','3524']). */
  plantAccess: string[];
  // ── Auto-populated from Plant mapping (derived from plantAccess) ──
  sector: string;
  bu: string;
  division: string;
  plant: string;
  roles: string[];
  status: 'Active' | 'Inactive';
  loginTime: string;   // last login timestamp, or 'Never'
  /** @deprecated legacy field — no longer shown/edited. Kept so seed rows compile. */
  position?: string;
}

/** Loose shape for the seed list — new fields are filled in the constructor. */
type SeedUser = Partial<AppUser> & Pick<AppUser, 'id' | 'firstName' | 'lastName' | 'email' | 'roles' | 'status' | 'loginTime'>;

/** Editable fields in the Create / Edit User modal. */
interface UserForm {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  plantAccess: string[];
  sector: string;
  bu: string;
  division: string;
  plant: string;
  roles: string[];
  status: 'Active' | 'Inactive';
}

@Component({
  selector: 'app-users',
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss']
})
export class UsersComponent {
  /** Role (SW Authorization) names offered in the filter + form, each with a chip colour. */
  roleOptions: string[] = ['Administrator', 'Site MGT', 'Contract Manager', 'Project Engineer', 'QA/QC Engineer', 'Viewer'];

  /** chip colour per role: [text, background, border] */
  private roleColors: Record<string, [string, string, string]> = {
    'Administrator':    ['#d97706', 'rgba(217,119,6,0.12)',  'rgba(217,119,6,0.30)'],
    'Site MGT':         ['#0891b2', 'rgba(8,145,178,0.12)',  'rgba(8,145,178,0.28)'],
    'Contract Manager': ['#29378d', 'rgba(41,55,141,0.10)',  'rgba(41,55,141,0.25)'],
    'Project Engineer': ['#16a34a', 'rgba(22,163,74,0.12)',  'rgba(22,163,74,0.28)'],
    'QA/QC Engineer':   ['#7c3aed', 'rgba(124,58,237,0.12)', 'rgba(124,58,237,0.28)'],
    'Viewer':           ['#6b7280', 'rgba(107,114,128,0.12)','rgba(107,114,128,0.30)']
  };

  /** Plant-code → org mapping. Sector / BU / Division / Plant auto-populate from this. */
  private plantMap: Record<string, { sector: string; bu: string; division: string; plant: string }> = {
    '3522': { sector: 'Construction & Real Estate', bu: 'Energy', division: 'Oil Field Projects', plant: 'Nimr ODC' },
    '3524': { sector: 'Construction & Real Estate', bu: 'Energy', division: 'Gas Field Projects', plant: 'Coastal' },
    '3521': { sector: 'Construction & Real Estate', bu: 'Energy', division: 'Oil Field Projects', plant: 'Coastal' }
  };

  /** Plant-access codes offered as checkboxes in the form. */
  plantCodeOptions: string[] = Object.keys(this.plantMap);

  private avatarPalette: string[] = ['#29378d', '#db2777', '#0d9488', '#7c3aed', '#16a34a', '#d97706', '#dc2626', '#0891b2'];

  /** Seed list — Sector/BU/Division/Plant/employeeId are filled in the constructor
      from plantAccess where a row doesn't specify them explicitly. */
  private rawUsers: SeedUser[] = [
    { id: 27, firstName: 'Sujith',  lastName: '', email: 'sujith@company.com',  employeeId: '118416',
      plantAccess: ['3522'], sector: 'Construction & Real Estate', bu: 'Energy', division: 'Oil Field Projects', plant: 'Nimr ODC',
      roles: ['Site MGT'],       status: 'Active', loginTime: '30 Jun 2026, 09:10' },
    { id: 28, firstName: 'Hansraj', lastName: '', email: 'hansraj@company.com', employeeId: '118327',
      plantAccess: ['3522', '3524', '3521'], sector: 'Construction & Real Estate', bu: 'Energy', division: 'Oil Field Projects & Gas Field Projects', plant: 'Coastal',
      roles: ['Administrator'],   status: 'Active', loginTime: '30 Jun 2026, 08:20' },
    { id: 1,  firstName: 'Arun',    lastName: 'Suresh',   email: 'arun.suresh@company.com',   position: 'Contracts Lead',        roles: ['Contract Manager'],                  status: 'Active',   loginTime: '29 Jun 2026, 09:14' },
    { id: 2,  firstName: 'Priya',   lastName: 'Ramesh',   email: 'priya.ramesh@company.com',  position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '29 Jun 2026, 08:52' },
    { id: 3,  firstName: 'Mohamed', lastName: 'Javed',    email: 'javed.m@company.com',       position: 'QA/QC Inspector',       roles: ['QA/QC Engineer'],                    status: 'Active',   loginTime: '28 Jun 2026, 17:40' },
    { id: 4,  firstName: 'Leena',   lastName: 'Sharma',   email: 'leena.sharma@company.com',  position: 'Data Analyst',          roles: ['Viewer'],                            status: 'Active',   loginTime: '28 Jun 2026, 11:05' },
    { id: 5,  firstName: 'Rakesh',  lastName: 'Kumar',    email: 'rakesh.k@company.com',      position: 'System Administrator',  roles: ['Administrator'],                     status: 'Active',   loginTime: '29 Jun 2026, 07:30' },
    { id: 6,  firstName: 'Sara',    lastName: 'Abdullah', email: 'sara.a@company.com',        position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '27 Jun 2026, 14:22' },
    { id: 7,  firstName: 'Vikram',  lastName: 'Nair',     email: 'vikram.nair@company.com',   position: 'Contracts Lead',        roles: ['Contract Manager'],                  status: 'Inactive', loginTime: '12 Jun 2026, 10:11' },
    { id: 8,  firstName: 'Aisha',   lastName: 'Khan',     email: 'aisha.khan@company.com',    position: 'QA/QC Inspector',       roles: ['QA/QC Engineer', 'Viewer'],          status: 'Active',   loginTime: '29 Jun 2026, 09:01' },
    { id: 9,  firstName: 'Daniel',  lastName: 'George',   email: 'daniel.g@company.com',      position: 'Data Analyst',          roles: ['Viewer'],                            status: 'Active',   loginTime: '26 Jun 2026, 16:48' },
    { id: 10, firstName: 'Fatima',  lastName: 'Noor',     email: 'fatima.noor@company.com',   position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '28 Jun 2026, 13:37' },
    { id: 11, firstName: 'Kiran',   lastName: 'Joseph',   email: 'kiran.j@company.com',       position: 'System Administrator',  roles: ['Administrator'],                     status: 'Inactive', loginTime: '02 Jun 2026, 09:20' },
    { id: 12, firstName: 'Neha',    lastName: 'Pillai',   email: 'neha.pillai@company.com',   position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '29 Jun 2026, 08:10' },
    { id: 13, firstName: 'Omar',    lastName: 'Saleh',    email: 'omar.saleh@company.com',    position: 'Operations Manager',    roles: ['Contract Manager', 'Project Engineer'], status: 'Active', loginTime: '28 Jun 2026, 15:55' },
    { id: 14, firstName: 'Reshma',  lastName: 'Das',      email: 'reshma.das@company.com',    position: 'QA/QC Inspector',       roles: ['QA/QC Engineer'],                    status: 'Active',   loginTime: '27 Jun 2026, 10:30' },
    { id: 15, firstName: 'Tariq',   lastName: 'Aziz',     email: 'tariq.aziz@company.com',    position: 'Data Analyst',          roles: ['Viewer'],                            status: 'Inactive', loginTime: 'Never' },
    { id: 16, firstName: 'Anjali',  lastName: 'Menon',    email: 'anjali.m@company.com',      position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '29 Jun 2026, 07:58' },
    { id: 17, firstName: 'Hassan',  lastName: 'Ali',      email: 'hassan.ali@company.com',    position: 'Contracts Lead',        roles: ['Contract Manager'],                  status: 'Active',   loginTime: '26 Jun 2026, 12:14' },
    { id: 18, firstName: 'Meera',   lastName: 'Krishnan', email: 'meera.k@company.com',       position: 'QA/QC Inspector',       roles: ['QA/QC Engineer'],                    status: 'Active',   loginTime: '28 Jun 2026, 09:42' },
    { id: 19, firstName: 'Sanjay',  lastName: 'Gupta',    email: 'sanjay.g@company.com',      position: 'System Administrator',  roles: ['Administrator'],                     status: 'Active',   loginTime: '29 Jun 2026, 06:50' },
    { id: 20, firstName: 'Layla',   lastName: 'Hamdan',   email: 'layla.h@company.com',       position: 'Data Analyst',          roles: ['Viewer'],                            status: 'Active',   loginTime: '25 Jun 2026, 18:03' },
    { id: 21, firstName: 'Rohit',   lastName: 'Verma',    email: 'rohit.verma@company.com',   position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '29 Jun 2026, 08:33' },
    { id: 22, firstName: 'Divya',   lastName: 'Rao',      email: 'divya.rao@company.com',     position: 'Contracts Lead',        roles: ['Contract Manager'],                  status: 'Inactive', loginTime: '08 Jun 2026, 11:27' },
    { id: 23, firstName: 'Yusuf',   lastName: 'Ibrahim',  email: 'yusuf.i@company.com',       position: 'QA/QC Inspector',       roles: ['QA/QC Engineer'],                    status: 'Active',   loginTime: '28 Jun 2026, 14:09' },
    { id: 24, firstName: 'Pooja',   lastName: 'Shetty',   email: 'pooja.shetty@company.com',  position: 'Data Analyst',          roles: ['Viewer'],                            status: 'Active',   loginTime: '27 Jun 2026, 09:16' },
    { id: 25, firstName: 'Imran',   lastName: 'Sheikh',   email: 'imran.sheikh@company.com',  position: 'Project Engineer',      roles: ['Project Engineer'],                  status: 'Active',   loginTime: '29 Jun 2026, 09:20' },
    { id: 26, firstName: 'Grace',   lastName: 'Thomas',   email: 'grace.thomas@company.com',  position: 'System Administrator',  roles: ['Administrator'],                     status: 'Active',   loginTime: '29 Jun 2026, 05:44' }
  ];

  /** Fully-resolved user list rendered by the grid. */
  users: AppUser[] = [];

  constructor() {
    const rotate = ['3522', '3524', '3521'];
    this.users = this.rawUsers.map((u, i) => {
      const plantAccess = u.plantAccess ?? [rotate[i % rotate.length]];
      const d = this.derivePlantMapping(plantAccess);
      return {
        id:         u.id,
        employeeId: u.employeeId ?? String(110000 + u.id),
        firstName:  u.firstName,
        lastName:   u.lastName,
        email:      u.email,
        plantAccess,
        sector:     u.sector   ?? d.sector,
        bu:         u.bu       ?? d.bu,
        division:   u.division ?? d.division,
        plant:      u.plant    ?? d.plant,
        roles:      u.roles,
        status:     u.status,
        loginTime:  u.loginTime
      };
    });
  }

  /** Aggregate Sector / BU / Division / Plant for a set of plant-access codes. */
  derivePlantMapping(codes: string[]): { sector: string; bu: string; division: string; plant: string } {
    const rows = codes.map(c => this.plantMap[c]).filter(Boolean);
    const uniq = (vals: string[]) => vals.filter((v, i) => v && vals.indexOf(v) === i);
    return {
      sector:   uniq(rows.map(r => r.sector)).join(' & '),
      bu:       uniq(rows.map(r => r.bu)).join(' & '),
      division: uniq(rows.map(r => r.division)).join(' & '),
      plant:    uniq(rows.map(r => r.plant)).join(', ')
    };
  }

  search = '';
  roleFilter = '';

  pageSize = 5;
  page = 1;

  openMenuId: number | null = null;

  // ── Add / edit modal ──
  modalOpen = false;
  editing: AppUser | null = null;
  form: UserForm = this.blankForm();

  private blankForm(): UserForm {
    return {
      employeeId: '', firstName: '', lastName: '', email: '',
      plantAccess: [], sector: '', bu: '', division: '', plant: '',
      roles: [], status: 'Active'
    };
  }

  // ── Derived data ──
  get filteredUsers(): AppUser[] {
    const q = this.search.trim().toLowerCase();
    return this.users.filter(u => {
      const matchesQ = !q ||
        u.firstName.toLowerCase().includes(q) ||
        u.lastName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.employeeId.toLowerCase().includes(q) ||
        u.plantAccess.join(', ').toLowerCase().includes(q);
      const matchesRole = !this.roleFilter || u.roles.includes(this.roleFilter);
      return matchesQ && matchesRole;
    });
  }

  get totalPages(): number { return Math.max(1, Math.ceil(this.filteredUsers.length / this.pageSize)); }

  get pagedUsers(): AppUser[] {
    const start = (this.page - 1) * this.pageSize;
    return this.filteredUsers.slice(start, start + this.pageSize);
  }

  get rangeStart(): number { return this.filteredUsers.length === 0 ? 0 : (this.page - 1) * this.pageSize + 1; }
  get rangeEnd(): number { return Math.min(this.page * this.pageSize, this.filteredUsers.length); }

  /** Page numbers to render, with -1 marking an ellipsis gap. */
  get pageWindow(): number[] {
    const total = this.totalPages;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: number[] = [1];
    const from = Math.max(2, this.page - 1);
    const to = Math.min(total - 1, this.page + 1);
    if (from > 2) pages.push(-1);
    for (let i = from; i <= to; i++) pages.push(i);
    if (to < total - 1) pages.push(-1);
    pages.push(total);
    return pages;
  }

  // ── Display helpers ──
  initials(u: AppUser): string { return ((u.firstName[0] || '') + (u.lastName[0] || '')).toUpperCase(); }
  avatarColor(u: AppUser): string { return this.avatarPalette[u.id % this.avatarPalette.length]; }
  roleColor(role: string): [string, string, string] { return this.roleColors[role] || ['#6b7280', 'rgba(107,114,128,0.12)', 'rgba(107,114,128,0.3)']; }

  // ── Filtering / paging ──
  onFilterChange(): void { this.page = 1; }
  resetFilters(): void { this.search = ''; this.roleFilter = ''; this.page = 1; }
  goTo(p: number): void { if (p >= 1 && p <= this.totalPages) this.page = p; }
  prev(): void { this.goTo(this.page - 1); }
  next(): void { this.goTo(this.page + 1); }

  // ── Row action menu ──
  toggleMenu(u: AppUser, ev: Event): void {
    ev.stopPropagation();
    this.openMenuId = this.openMenuId === u.id ? null : u.id;
  }
  @HostListener('document:click') closeMenu(): void { this.openMenuId = null; }

  // ── Roles multi-select (in modal) ──
  hasRole(r: string): boolean { return this.form.roles.includes(r); }
  toggleRole(r: string): void {
    const i = this.form.roles.indexOf(r);
    if (i >= 0) this.form.roles.splice(i, 1);
    else this.form.roles.push(r);
  }

  // ── Plant Access multi-select (in modal) — drives the auto-populated fields ──
  hasPlant(code: string): boolean { return this.form.plantAccess.includes(code); }
  togglePlant(code: string): void {
    const i = this.form.plantAccess.indexOf(code);
    if (i >= 0) this.form.plantAccess.splice(i, 1);
    else this.form.plantAccess.push(code);
    this.applyPlantMapping();
  }
  /** Recompute Sector / BU / Division / Plant from the selected plant-access codes. */
  private applyPlantMapping(): void {
    const d = this.derivePlantMapping(this.form.plantAccess);
    this.form.sector = d.sector;
    this.form.bu = d.bu;
    this.form.division = d.division;
    this.form.plant = d.plant;
  }

  // ── CRUD ──
  openAdd(): void {
    this.editing = null;
    this.form = this.blankForm();
    this.modalOpen = true;
  }
  openEdit(u: AppUser): void {
    this.editing = u;
    this.form = {
      employeeId: u.employeeId, firstName: u.firstName, lastName: u.lastName, email: u.email,
      plantAccess: [...u.plantAccess], sector: u.sector, bu: u.bu, division: u.division, plant: u.plant,
      roles: [...u.roles], status: u.status
    };
    this.modalOpen = true;
    this.openMenuId = null;
  }
  closeModal(): void { this.modalOpen = false; this.editing = null; }

  save(): void {
    if (!this.form.firstName.trim() || !this.form.email.trim() || !this.form.roles.length) return;
    const data = { ...this.form, plantAccess: [...this.form.plantAccess], roles: [...this.form.roles] };
    if (this.editing) {
      Object.assign(this.editing, data);
    } else {
      const id = this.users.reduce((m, u) => Math.max(m, u.id), 0) + 1;
      this.users.unshift({ id, ...data, loginTime: 'Never' });
      this.page = 1;
    }
    this.closeModal();
  }

  remove(u: AppUser): void {
    this.openMenuId = null;
    if (!confirm(`Remove user "${u.firstName} ${u.lastName}"?`)) return;
    this.users = this.users.filter(x => x.id !== u.id);
    if (this.page > this.totalPages) this.page = this.totalPages;
  }

  toggleStatus(u: AppUser): void {
    this.openMenuId = null;
    u.status = u.status === 'Active' ? 'Inactive' : 'Active';
  }
}
