import { Component, AfterViewInit, OnDestroy, ElementRef, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  SCHEMA, OPS, DbViewSpec, DbCondition, generateSQL, runPreview, orderedColumns,
  columnHeader, getView, saveView
} from '../../features/db-views/db-views';

/**
 * Database View Builder — a faithful Angular port of the standalone builder.
 * Pick tables from the catalog, define joins, choose columns/aliases and
 * filters; the SQL and a live data preview (run over the demo dataset) update
 * as you go. Saving persists a DbViewSpec that shows up in Database Views.
 *
 * The panels are rendered imperatively via innerHTML (as in the original), so
 * ViewEncapsulation is disabled and all styling is id-scoped in the SCSS. All
 * DOM lookups are scoped to this component's host element to avoid clashes.
 */
interface BuilderState {
  name: string;
  distinct: boolean;
  tables: Array<{ id: number; table: string; alias: string }>;
  joins: Record<number, { type: string; conditions: DbCondition[] }>;
  checked: Set<string>;
  aliases: Record<string, string>;
  filters: Array<{ fid: number; tableId: number; col: string; op: string; value: string; connector: string }>;
  manualSql: string | null;
  editing: boolean;
  tab: string;
}

@Component({
  selector: 'app-db-view-builder',
  templateUrl: './db-view-builder.component.html',
  styleUrls: ['./db-view-builder.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DbViewBuilderComponent implements AfterViewInit, OnDestroy {

  private uid = 1;
  private editId: string | null = null;
  private toastT: any = null;
  private root!: HTMLElement;

  private state: BuilderState = {
    name: 'well_activity_view', distinct: false,
    tables: [], joins: {}, checked: new Set<string>(), aliases: {},
    filters: [], manualSql: null, editing: false, tab: 'sql'
  };

  constructor(private host: ElementRef<HTMLElement>, private router: Router, route: ActivatedRoute) {
    this.editId = route.snapshot.queryParamMap.get('id');
  }

  ngAfterViewInit(): void { setTimeout(() => this.init(), 40); }
  ngOnDestroy(): void { clearTimeout(this.toastT); }

  /* ── scoped DOM helpers ── */
  private $(id: string): HTMLElement | null { return this.root.querySelector('#dvb-' + id); }
  private esc(s: any): string {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
  }
  private tById(id: number) { return this.state.tables.find(t => t.id === id); }
  private takenAliases() { return new Set(this.state.tables.map(t => t.alias)); }

  /* ── spec snapshot (feeds the shared SQL / preview engine) ── */
  private toSpec(id = 'preview'): DbViewSpec {
    return {
      id, name: (this.$('vname') as HTMLInputElement)?.value?.trim() || this.state.name,
      distinct: this.state.distinct,
      tables: this.state.tables.map(t => ({ ...t })),
      joins: JSON.parse(JSON.stringify(this.state.joins)),
      checked: [...this.state.checked],
      aliases: { ...this.state.aliases },
      filters: this.state.filters.map(f => ({ ...f })),
      manualSql: this.state.manualSql
    };
  }
  private currentSQL(): string {
    return this.state.manualSql !== null ? this.state.manualSql : generateSQL(this.toSpec());
  }

  /* ── alias / FK helpers ── */
  private makeAlias(name: string): string {
    const words = name.split('_');
    let base = words.length > 1 ? words.map(w => w[0]).join('') : name.slice(0, 3);
    base = base.toLowerCase(); const taken = this.takenAliases();
    let a = base, i = 1; while (taken.has(a)) { a = base + i; i++; } return a;
  }
  private findFk(aTable: string, bTable: string): { from: string; col: string; toCol: string } | null {
    for (const c of SCHEMA[aTable].columns) if (c.fk && c.fk.table === bTable) return { from: aTable, col: c.n, toCol: c.fk.col };
    for (const c of SCHEMA[bTable].columns) if (c.fk && c.fk.table === aTable) return { from: bTable, col: c.n, toCol: c.fk.col };
    return null;
  }

  /* ── mutations ── */
  private addTable(name: string): void {
    const id = this.uid++;
    const t = { id, table: name, alias: this.makeAlias(name) };
    this.state.tables.push(t);
    SCHEMA[name].columns.forEach(c => this.state.checked.add(id + '.' + c.n));
    if (this.state.tables.length > 1) {
      let cond: DbCondition | null = null;
      for (const prev of this.state.tables.slice(0, -1)) {
        const fk = this.findFk(prev.table, name);
        if (fk) {
          if (fk.from === name) cond = { leftId: prev.id, leftCol: fk.toCol, rightCol: fk.col };
          else cond = { leftId: prev.id, leftCol: fk.col, rightCol: fk.toCol };
          break;
        }
      }
      if (!cond) cond = { leftId: this.state.tables[this.state.tables.length - 2].id, leftCol: '', rightCol: '' };
      this.state.joins[id] = { type: 'LEFT', conditions: [cond] };
    }
  }
  private removeTable(id: number): void {
    this.state.tables = this.state.tables.filter(t => t.id !== id);
    delete this.state.joins[id];
    Object.values(this.state.joins).forEach(j => { j.conditions = j.conditions.filter(c => c.leftId !== id); });
    [...this.state.checked].forEach(k => { if (k.startsWith(id + '.')) this.state.checked.delete(k); });
    Object.keys(this.state.aliases).forEach(k => { if (k.startsWith(id + '.')) delete this.state.aliases[k]; });
    this.state.filters = this.state.filters.filter(f => f.tableId !== id);
    if (this.state.tables.length && this.state.joins[this.state.tables[0].id]) delete this.state.joins[this.state.tables[0].id];
  }
  private setBase(id: number): void {
    const t = this.tById(id); if (!t) return;
    this.state.tables = [t, ...this.state.tables.filter(x => x.id !== id)];
    delete this.state.joins[id];
    this.state.tables.slice(1).forEach(nt => { if (!this.state.joins[nt.id]) this.state.joins[nt.id] = { type: 'LEFT', conditions: [{ leftId: this.state.tables[0].id, leftCol: '', rightCol: '' }] }; });
  }

  /* ── rendering ── */
  private highlight(sql: string): string {
    let h = this.esc(sql);
    h = h.replace(/'[^']*'/g, m => '<span class="str">' + m + '</span>');
    const kws = ['CREATE', 'OR', 'REPLACE', 'VIEW', 'AS', 'SELECT', 'DISTINCT', 'FROM', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'JOIN', 'ON', 'AND', 'WHERE', 'LIKE'];
    h = h.replace(new RegExp('\\b(' + kws.join('|') + ')\\b', 'g'), '<span class="kw">$1</span>');
    h = h.replace(/(^|\n)(--.*)/g, '$1<span style="color:#6b8598">$2</span>');
    return h;
  }
  private optionsFor(cols: any[], sel: string): string {
    return cols.map(c => `<option value="${c.n}"${c.n === sel ? ' selected' : ''}>${c.n}</option>`).join('');
  }
  private allColCount(): number { let a = 0; this.state.tables.forEach(t => a += SCHEMA[t.table].columns.length); return a; }

  private renderCatalog(): void {
    const q = ((this.$('catSearch') as HTMLInputElement)?.value || '').trim().toLowerCase();
    const list = this.$('tableList'); if (!list) return; list.innerHTML = '';
    Object.keys(SCHEMA).forEach(name => {
      const cols = SCHEMA[name].columns;
      const match = !q || name.includes(q) || cols.some(c => c.n.includes(q));
      if (!match) return;
      const added = this.state.tables.some(t => t.table === name);
      const div = document.createElement('div'); div.className = 'tbl' + (q ? ' open' : '');
      div.innerHTML = `
        <div class="tbl-row" data-toggle="${name}">
          <span class="ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg></span>
          <div><div class="tbl-name">${this.esc(name)}</div><div class="tbl-meta">${cols.length} columns</div></div>
          ${added ? '<span class="added-badge">Added</span>' : '<button class="btn sm add" data-add="' + name + '">Add</button>'}
        </div>
        <div class="cols">${cols.map(c => `
          <div class="col-line"><span class="cn">${this.esc(c.n)}</span><span class="ct">${c.t}</span>
          ${c.pk ? '<span class="kbadge pk">PK</span>' : ''}${c.fk ? '<span class="kbadge fk">FK</span>' : ''}</div>`).join('')}</div>`;
      list.appendChild(div);
    });
  }

  private renderJoins(): void {
    const area = this.$('joinArea'); if (!area) return; area.innerHTML = '';
    const jc = this.$('joinCount'); if (jc) jc.textContent = this.state.tables.length ? this.state.tables.length + ' table' + (this.state.tables.length > 1 ? 's' : '') : '';
    if (!this.state.tables.length) { area.innerHTML = '<div class="empty-hint">Add a table from the left panel. The first table becomes the base (<span class="mono">FROM</span>); each additional table is joined to it.</div>'; return; }
    this.state.tables.forEach((t, idx) => {
      const isBase = idx === 0;
      const card = document.createElement('div'); card.className = 'tcard ' + (isBase ? 'base' : 'join');
      const cols = SCHEMA[t.table].columns;
      let head = `<div class="thead"><span class="badge ${isBase ? 'base' : 'join'}">${isBase ? 'Base' : 'Join'}</span>`;
      if (!isBase) {
        const j = this.state.joins[t.id] || { type: 'LEFT' };
        head += `<select class="sel jointype" data-jtype="${t.id}">${['INNER', 'LEFT', 'RIGHT', 'FULL'].map(x => `<option${x === j.type ? ' selected' : ''}>${x}</option>`).join('')}</select><span style="color:var(--muted);font-weight:600">JOIN</span>`;
      } else { head += `<span style="color:var(--muted);font-weight:600">FROM</span>`; }
      head += `<span class="tn">${this.esc(t.table)}</span><span class="as">AS</span>
        <input class="alias-in" data-alias="${t.id}" value="${this.esc(t.alias)}" spellcheck="false">
        <span class="sp"></span>
        ${!isBase ? `<button class="btn tiny" data-setbase="${t.id}">Set as base</button>` : ''}
        <button class="icon-btn" data-rmtable="${t.id}" title="Remove table">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
        </div>`;
      card.innerHTML = head;

      if (!isBase) {
        const j = this.state.joins[t.id] || { type: 'LEFT', conditions: [] };
        const others = this.state.tables.filter(x => x.id !== t.id);
        const on = document.createElement('div'); on.className = 'on-area';
        let inner = `<div class="on-label">On</div>`;
        (j.conditions || []).forEach((c, ci) => {
          const lt = this.tById(c.leftId) || others[0] || t;
          const lcols = SCHEMA[lt.table].columns;
          inner += `<div class="cond">
            <select class="sel mono" data-cleft="${t.id}:${ci}">
              ${others.map(o => `<option value="${o.id}"${o.id === c.leftId ? ' selected' : ''}>${o.alias} · ${o.table}</option>`).join('')}
            </select>
            <select class="sel mono" data-clcol="${t.id}:${ci}">${this.optionsFor(lcols, c.leftCol)}</select>
            <span class="eq">=</span>
            <span class="fixed">${this.esc(t.alias)}.</span>
            <select class="sel mono" data-crcol="${t.id}:${ci}">${this.optionsFor(cols, c.rightCol)}</select>
            <button class="icon-btn" data-rmcond="${t.id}:${ci}" title="Remove condition">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14"/></svg></button>
          </div>`;
        });
        if (!(j.conditions || []).some(c => c.leftCol && c.rightCol)) inner += `<div class="warn-cond">⚠ Pick both columns to complete this join.</div>`;
        inner += `<button class="btn tiny" data-addcond="${t.id}" style="margin-top:2px">+ Add condition (AND)</button>`;
        on.innerHTML = inner; card.appendChild(on);
      }
      area.appendChild(card);
    });
  }

  private renderColumns(): void {
    const area = this.$('colArea'); if (!area) return;
    const total = orderedColumns(this.toSpec()).length;
    const cc = this.$('colCount'); if (cc) cc.textContent = this.state.tables.length ? total + ' of ' + this.allColCount() + ' selected' : '';
    if (!this.state.tables.length) { area.innerHTML = '<div class="empty-hint">Columns appear here once you add tables.</div>'; return; }
    let html = `<table class="coltbl"><thead><tr><th style="width:34px"></th><th>Column</th><th style="width:70px">Type</th><th style="width:170px">Output alias</th></tr></thead><tbody>`;
    this.state.tables.forEach(t => {
      const cols = SCHEMA[t.table].columns;
      const selCount = cols.filter(c => this.state.checked.has(t.id + '.' + c.n)).length;
      html += `<tr class="grp-row"><td colspan="4">
        <span class="talias">${this.esc(t.alias)}</span> · ${this.esc(t.table)}
        <button class="btn tiny mini2" data-tall="${t.id}">all</button>
        <button class="btn tiny" data-tnone="${t.id}">none</button>
        <span class="ct2" style="margin-left:6px">${selCount}/${cols.length}</span></td></tr>`;
      cols.forEach(c => {
        const key = t.id + '.' + c.n; const on = this.state.checked.has(key);
        html += `<tr>
          <td><input type="checkbox" data-col="${key}"${on ? ' checked' : ''}></td>
          <td><span class="cn2">${this.esc(c.n)}</span>${c.pk ? ' <span class="kbadge pk">PK</span>' : ''}${c.fk ? ' <span class="kbadge fk">FK</span>' : ''}</td>
          <td class="ct2">${c.t}</td>
          <td><input class="al-in" data-colalias="${key}" placeholder="${this.esc(c.n)}" value="${this.esc(this.state.aliases[key] || '')}" spellcheck="false"${on ? '' : ' disabled'}></td>
        </tr>`;
      });
    });
    html += `</tbody></table>`;
    area.innerHTML = html;
  }

  private renderFilters(): void {
    const area = this.$('filterArea'); if (!area) return;
    if (!this.state.tables.length) { area.innerHTML = '<div class="empty-hint">Add tables to filter their rows.</div>'; return; }
    if (!this.state.filters.length) { area.innerHTML = '<div class="empty-hint">No filters. The view returns all joined rows. Use “+ Add condition” to add a <span class="mono">WHERE</span> clause.</div>'; return; }
    let html = '';
    this.state.filters.forEach((f, i) => {
      const t = this.tById(f.tableId) || this.state.tables[0];
      const cols = SCHEMA[t.table].columns;
      html += `<div class="filt">
        ${i > 0 ? `<select class="sel conn" data-fconn="${f.fid}">${['AND', 'OR'].map(x => `<option${x === (f.connector || 'AND') ? ' selected' : ''}>${x}</option>`).join('')}</select>` : '<span class="conn" style="color:var(--muted);font-weight:600;text-align:center;font-size:12px">WHERE</span>'}
        <select class="sel mono" data-ftable="${f.fid}">${this.state.tables.map(x => `<option value="${x.id}"${x.id === f.tableId ? ' selected' : ''}>${x.alias} · ${x.table}</option>`).join('')}</select>
        <select class="sel mono" data-fcol="${f.fid}">${this.optionsFor(cols, f.col)}</select>
        <select class="sel" data-fop="${f.fid}">${OPS.map(([v, l]) => `<option value="${v}"${v === f.op ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <input class="val-in" data-fval="${f.fid}" value="${this.esc(f.value || '')}" placeholder="value" spellcheck="false">
        <button class="icon-btn" data-rmfilter="${f.fid}" title="Remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14"/></svg></button>
      </div>`;
    });
    area.innerHTML = html;
  }

  private renderSQL(): void {
    const sql = this.currentSQL();
    const pre = this.$('sqlPre'); if (pre) pre.innerHTML = this.highlight(sql);
    const ta = this.root.querySelector('textarea.sqledit') as HTMLTextAreaElement | null;
    if (ta && this.state.editing) ta.value = sql;
    this.$('manualBanner')?.classList.toggle('show', this.state.manualSql !== null);
  }

  private renderPreview(): void {
    const { cols, rows, note } = runPreview(this.toSpec());
    const pvNote = this.$('pvNote');
    if (pvNote) pvNote.textContent = (note ? note + '  ·  ' : '') + rows.length + ' row' + (rows.length !== 1 ? 's' : '') + (this.state.manualSql !== null ? '  ·  preview reflects the builder, not manual SQL' : '');
    const wrap = this.$('pvWrap'); if (!wrap) return;
    if (!cols.length) { wrap.innerHTML = '<div style="padding:16px;color:#8fb0c6;font-size:12.5px">Select at least one column.</div>'; return; }
    let html = '<table class="pv"><thead><tr>' + cols.map(c => `<th>${this.esc(columnHeader(c))}</th>`).join('') + '</tr></thead><tbody>';
    rows.slice(0, 60).forEach(r => { html += '<tr>' + r.map((v: any) => `<td>${v == null || v === '' ? '<span class="null">NULL</span>' : this.esc(v)}</td>`).join('') + '</tr>'; });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  private renderAll(): void {
    this.renderCatalog(); this.renderJoins(); this.renderColumns(); this.renderFilters(); this.renderSQL();
    if (this.state.tab === 'preview') this.renderPreview();
  }
  private afterColBulk(): void { if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview(); }
  private postStructural(rebuild = false): void {
    this.renderJoins(); if (rebuild) this.renderColumns();
    if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview();
  }

  private toast(msg: string): void {
    const el = this.$('toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ── init: wire events + seed / load ── */
  private init(): void {
    this.root = this.host.nativeElement;
    const findFilter = (id: any) => this.state.filters.find(x => x.fid == id);

    this.$('catSearch')?.addEventListener('input', () => this.renderCatalog());
    this.$('tableList')?.addEventListener('click', (e: any) => {
      const add = e.target.closest('[data-add]'); if (add) { this.addTable(add.getAttribute('data-add')); this.renderAll(); return; }
      const tog = e.target.closest('[data-toggle]'); if (tog && !e.target.closest('[data-add]')) { tog.parentElement.classList.toggle('open'); }
    });
    (this.$('vname') as HTMLInputElement)?.addEventListener('input', (e: any) => { this.state.name = e.target.value; if (this.state.manualSql === null) this.renderSQL(); });
    (this.$('distinct') as HTMLInputElement)?.addEventListener('change', (e: any) => { this.state.distinct = e.target.checked; if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview(); });

    // Joins — structural changes
    this.$('joinArea')?.addEventListener('change', (e: any) => {
      const el = e.target;
      if (el.dataset.jtype) { this.state.joins[+el.dataset.jtype].type = el.value; this.postStructural(); }
      else if (el.dataset.cleft) { const [id, ci] = el.dataset.cleft.split(':'); this.state.joins[+id].conditions[+ci].leftId = +el.value; this.state.joins[+id].conditions[+ci].leftCol = ''; this.postStructural(); }
      else if (el.dataset.clcol) { const [id, ci] = el.dataset.clcol.split(':'); this.state.joins[+id].conditions[+ci].leftCol = el.value; this.postStructural(); }
      else if (el.dataset.crcol) { const [id, ci] = el.dataset.crcol.split(':'); this.state.joins[+id].conditions[+ci].rightCol = el.value; this.postStructural(); }
    });
    this.$('joinArea')?.addEventListener('click', (e: any) => {
      const t = e.target;
      const b = t.closest('[data-rmtable]'); if (b) { this.removeTable(+b.dataset.rmtable); this.renderAll(); return; }
      const sb = t.closest('[data-setbase]'); if (sb) { this.setBase(+sb.dataset.setbase); this.renderAll(); return; }
      const ac = t.closest('[data-addcond]'); if (ac) { const id = +ac.dataset.addcond; const others = this.state.tables.filter(x => x.id !== id); this.state.joins[id].conditions.push({ leftId: others[0] ? others[0].id : id, leftCol: '', rightCol: '' }); this.postStructural(true); return; }
      const rc = t.closest('[data-rmcond]'); if (rc) { const [id, ci] = rc.dataset.rmcond.split(':'); this.state.joins[+id].conditions.splice(+ci, 1); if (!this.state.joins[+id].conditions.length) this.state.joins[+id].conditions.push({ leftId: this.state.tables[0].id, leftCol: '', rightCol: '' }); this.postStructural(true); return; }
    });
    this.$('joinArea')?.addEventListener('input', (e: any) => {
      if (e.target.dataset.alias) { const t = this.tById(+e.target.dataset.alias); if (t) { t.alias = e.target.value.replace(/\s/g, ''); if (this.state.manualSql === null) this.renderSQL(); } }
    });

    // Columns
    this.$('colArea')?.addEventListener('change', (e: any) => {
      const cb = e.target.closest('[data-col]');
      if (cb) {
        const key = cb.dataset.col; if (cb.checked) this.state.checked.add(key); else this.state.checked.delete(key);
        const al = this.root.querySelector('[data-colalias="' + key + '"]') as HTMLInputElement | null; if (al) al.disabled = !cb.checked;
        const cc = this.$('colCount'); if (cc) cc.textContent = orderedColumns(this.toSpec()).length + ' of ' + this.allColCount() + ' selected';
        if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview();
      }
    });
    this.$('colArea')?.addEventListener('input', (e: any) => {
      const al = e.target.closest('[data-colalias]'); if (al) { this.state.aliases[al.dataset.colalias] = al.value; if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview(); }
    });
    this.$('colArea')?.addEventListener('click', (e: any) => {
      const a = e.target.closest('[data-tall]'); if (a) { const id = +a.dataset.tall; SCHEMA[this.tById(id)!.table].columns.forEach(c => this.state.checked.add(id + '.' + c.n)); this.renderColumns(); this.afterColBulk(); return; }
      const n = e.target.closest('[data-tnone]'); if (n) { const id = +n.dataset.tnone; SCHEMA[this.tById(id)!.table].columns.forEach(c => this.state.checked.delete(id + '.' + c.n)); this.renderColumns(); this.afterColBulk(); return; }
    });
    this.$('allCols')?.addEventListener('click', () => { this.state.tables.forEach(t => SCHEMA[t.table].columns.forEach(c => this.state.checked.add(t.id + '.' + c.n))); this.renderColumns(); this.afterColBulk(); });
    this.$('noCols')?.addEventListener('click', () => { this.state.checked.clear(); this.renderColumns(); this.afterColBulk(); });

    // Filters
    this.$('addFilter')?.addEventListener('click', () => {
      if (!this.state.tables.length) { this.toast('Add a table first.'); return; }
      const t = this.state.tables[0]; this.state.filters.push({ fid: this.uid++, tableId: t.id, col: SCHEMA[t.table].columns[0].n, op: '=', value: '', connector: 'AND' });
      this.renderFilters(); if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview();
    });
    this.$('filterArea')?.addEventListener('change', (e: any) => {
      const el = e.target;
      if (el.dataset.ftable) { const o = findFilter(el.dataset.ftable)!; o.tableId = +el.value; o.col = SCHEMA[this.tById(o.tableId)!.table].columns[0].n; this.renderFilters(); }
      else if (el.dataset.fcol) { findFilter(el.dataset.fcol)!.col = el.value; }
      else if (el.dataset.fop) { findFilter(el.dataset.fop)!.op = el.value; }
      else if (el.dataset.fconn) { findFilter(el.dataset.fconn)!.connector = el.value; }
      if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview();
    });
    this.$('filterArea')?.addEventListener('input', (e: any) => {
      if (e.target.dataset.fval) { findFilter(e.target.dataset.fval)!.value = e.target.value; if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview(); }
    });
    this.$('filterArea')?.addEventListener('click', (e: any) => {
      const b = e.target.closest('[data-rmfilter]'); if (b) { this.state.filters = this.state.filters.filter(x => x.fid != b.dataset.rmfilter); this.renderFilters(); if (this.state.manualSql === null) this.renderSQL(); if (this.state.tab === 'preview') this.renderPreview(); }
    });

    // SQL tabs + tools
    this.root.querySelectorAll('.sqltab').forEach(tab => tab.addEventListener('click', () => {
      this.root.querySelectorAll('.sqltab').forEach(x => x.classList.remove('on')); tab.classList.add('on');
      this.state.tab = (tab as HTMLElement).dataset['tab'] || 'sql';
      (this.$('sqlBody') as HTMLElement).style.display = this.state.tab === 'sql' ? 'flex' : 'none';
      (this.$('previewBody') as HTMLElement).style.display = this.state.tab === 'preview' ? 'flex' : 'none';
      if (this.state.tab === 'preview') this.renderPreview();
    }));
    this.$('editSwitch')?.addEventListener('click', () => {
      this.state.editing = !this.state.editing;
      this.$('editSwitch')?.classList.toggle('on', this.state.editing);
      const scroll = this.$('sqlScroll')!;
      if (this.state.editing) {
        if (this.state.manualSql === null) this.state.manualSql = generateSQL(this.toSpec());
        scroll.innerHTML = '<textarea class="sqledit" spellcheck="false"></textarea>';
        const ta = scroll.querySelector('textarea') as HTMLTextAreaElement; ta.value = this.state.manualSql!;
        ta.addEventListener('input', () => { this.state.manualSql = ta.value; this.$('manualBanner')?.classList.add('show'); });
        ta.focus();
      } else {
        scroll.innerHTML = '<pre class="sql" id="dvb-sqlPre"></pre>';
        this.renderSQL();
      }
      this.$('manualBanner')?.classList.toggle('show', this.state.manualSql !== null);
    });
    this.$('regenBtn')?.addEventListener('click', () => {
      this.state.manualSql = null;
      const ta = this.root.querySelector('textarea.sqledit') as HTMLTextAreaElement | null;
      if (this.state.editing && ta) ta.value = generateSQL(this.toSpec());
      this.renderSQL(); this.toast('SQL regenerated from your selections.');
    });
    this.$('copyBtn')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this.currentSQL()); this.toast('SQL copied to clipboard.'); }
      catch { this.toast('Copy failed — select the text manually.'); }
    });

    // Top actions
    this.$('backBtn')?.addEventListener('click', () => this.router.navigateByUrl('/db-views'));
    this.$('createBtn')?.addEventListener('click', () => this.save());
    this.$('resetBtn')?.addEventListener('click', () => {
      this.state.tables = []; this.state.joins = {}; this.state.checked.clear(); this.state.aliases = {}; this.state.filters = [];
      this.state.manualSql = null; this.state.editing = false; this.$('editSwitch')?.classList.remove('on');
      this.state.distinct = false; (this.$('distinct') as HTMLInputElement).checked = false;
      this.$('sqlScroll')!.innerHTML = '<pre class="sql" id="dvb-sqlPre"></pre>';
      this.renderAll(); this.toast('Cleared.');
    });

    // Load (edit) or seed (new). Built-in views are opened as an editable copy
    // (editId stays null → Save creates a new view rather than overwriting).
    const spec = this.editId ? getView(this.editId) : null;
    if (spec) {
      if (spec.builtIn) this.editId = null;
      this.loadFromSpec(spec);
    } else {
      this.editId = null;
      this.seedDemo();
    }
    this.renderAll();
  }

  /** Default new-view demo: daily_plan ⨝ wells with a tidy column set. */
  private seedDemo(): void {
    this.addTable('daily_plan');
    this.addTable('wells');
    this.state.checked.clear();
    const dp = this.state.tables[0].id, w = this.state.tables[1].id;
    ['plan_date', 'discipline', 'contractor_type', 'manpower', 'equipment', 'vehicle'].forEach(c => this.state.checked.add(dp + '.' + c));
    ['well_name', 'well_category', 'status'].forEach(c => this.state.checked.add(w + '.' + c));
    (this.$('vname') as HTMLInputElement).value = this.state.name;
  }

  /** Load an existing spec into builder state (edit mode). */
  private loadFromSpec(spec: DbViewSpec): void {
    this.state.name = spec.name;
    this.state.distinct = !!spec.distinct;
    this.state.tables = spec.tables.map(t => ({ ...t }));
    this.state.joins = JSON.parse(JSON.stringify(spec.joins || {}));
    this.state.checked = new Set(spec.checked || []);
    this.state.aliases = { ...(spec.aliases || {}) };
    this.state.filters = (spec.filters || []).map(f => ({ ...f }));
    this.state.manualSql = spec.manualSql ?? null;
    // uid must clear every existing id (table ids and filter fids).
    const ids = [...spec.tables.map(t => t.id), ...(spec.filters || []).map(f => f.fid), 0];
    this.uid = Math.max(...ids) + 1;
    (this.$('vname') as HTMLInputElement).value = spec.name;
    (this.$('distinct') as HTMLInputElement).checked = this.state.distinct;
  }

  /** Persist the current builder state as a saved view, then go to the list. */
  private save(): void {
    const name = ((this.$('vname') as HTMLInputElement)?.value || '').trim();
    if (!this.state.tables.length) { this.toast('Add at least one table.'); return; }
    if (!name) { this.toast('Give the view a name.'); return; }
    const missing = this.state.tables.slice(1).some(t => !((this.state.joins[t.id]?.conditions) || []).some(c => c.leftCol && c.rightCol));
    if (missing) { this.toast('Complete every join condition first.'); return; }

    this.state.name = name;
    const id = this.editId || this.slug(name) + '-' + this.uid.toString(36) + '-' + this.state.tables.length;
    const spec = this.toSpec(id);
    spec.builtIn = false;
    spec.createdAt = this.editId ? (getView(this.editId)?.createdAt || Date.now()) : Date.now();
    saveView(spec);
    this.toast('View “' + name + '” saved.');
    setTimeout(() => this.router.navigateByUrl('/db-view-detail?id=' + id), 350);
  }

  private slug(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
}
