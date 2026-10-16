import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { DbSchemaColumn } from '../../../../core/services/common-api.service';
import {
  Cardinality, DatasetCalculatedColumn, DatasetDetail, DatasetMeasure, DatasetRelationship, DatasetSource, DatasetTransform, RlsBody, RlsMode,
} from '../../../../core/services/model-studio.service';
import { printMeasure } from '../../../../core/utils/measure-syntax.util';
import {
  OriginGroup, Selection, SourceOrigin, describeMeasure, describeTransform, fieldKind, originGroups, sameName, sourceOrigin, tableKey,
} from '../../model-studio.util';

/** A column as the Properties pane describes it: stored or calculated, with its keys and its transforms. */
interface ColumnView {
  source: DatasetSource;
  name: string;
  dataType: string;
  kind: string;
  stored: DbSchemaColumn | null;
  calculated: DatasetCalculatedColumn | null;
  transforms: DatasetTransform[];
  links: string[];
}

/**
 * The Properties pane: what is selected, as Power BI's Properties pane shows it. The dataset when nothing is,
 * a table (its source, size, row filter), a column (type, keys, formula, transforms), a relationship or a measure.
 */
@Component({
  selector: 'app-model-inspector',
  standalone: false,
  templateUrl: './inspector.component.html',
  styleUrls: ['./inspector.component.scss'],
})
export class InspectorComponent implements OnChanges {
  @Input() dataset: DatasetDetail | null = null;
  @Input() selection: Selection = null;
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  @Input() readonly = false;
  @Output() saveRls = new EventEmitter<{ sourceId: number; body: RlsBody }>();
  @Output() removeSource = new EventEmitter<DatasetSource>();
  @Output() saveCardinality = new EventEmitter<{ relationshipId: number; cardinality: Cardinality }>();
  /** A table's name as people read it and its description; formulas keep its alias. */
  @Output() saveSourceDetails = new EventEmitter<{ sourceId: number; caption: string | null; description: string | null }>();
  sourceCaption = '';
  sourceDescription = '';
  @Output() removeRelationship = new EventEmitter<number>();
  @Output() refreshViewSource = new EventEmitter<DatasetSource>();
  /** Binds the variables of a saved view (a script source) to model fields; null leaves one unbound. */
  @Output() saveParameters = new EventEmitter<{ sourceId: number; bindings: { name: string; field: string | null }[] }>();
  /** The field each variable of the selected saved view is bound to; '' when none. */
  paramFields: Record<string, string> = {};
  /** Every field of the model, by table, for binding a variable. */
  fieldGroups: { table: string; fields: string[] }[] = [];
  /** Opens the Transform dialog on a table, and on a column of it when given. */
  @Output() openTransforms = new EventEmitter<{ source: DatasetSource; column: string | null }>();
  @Output() editMeasure = new EventEmitter<DatasetMeasure>();
  @Output() editColumn = new EventEmitter<{ source: DatasetSource; column: DatasetCalculatedColumn }>();
  @Output() selectionChange = new EventEmitter<Selection>();
  /** Renames the dataset or changes its description (PUT /api/model/datasets/{id}). */
  @Output() saveDetails = new EventEmitter<{ name: string; description: string | null }>();
  @Output() collapse = new EventEmitter<void>();

  rlsMode: RlsMode = 'none';
  rlsColumn = '';
  cardinality: Cardinality = 'many_to_one';
  name = '';
  description = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dataset'] && this.dataset) {
      this.name = this.dataset.name;
      this.description = this.dataset.description ?? '';
    }
    if ((changes['dataset'] || changes['columns']) && this.dataset) {
      const dataset = this.dataset;
      this.fieldGroups = dataset.sources.map(s => ({
        table: s.caption || s.alias,
        fields: [...this.columnsOf(s).map(c => c.columnName), ...dataset.calculatedColumns.filter(c => c.sourceId === s.id).map(c => c.name)]
          .map(column => `${s.alias}.${column}`),
      }));
    }
    if (changes['selection'] || changes['dataset']) {
      const source = this.selectedSource;
      if (source) {
        this.paramFields = Object.fromEntries((source.parameters ?? []).map(p => [p.name, p.field ?? '']));
        this.rlsMode = source.rlsMode;
        this.rlsColumn = source.rlsPlantColumn ?? '';
        this.sourceCaption = source.caption ?? source.alias;
        this.sourceDescription = source.description ?? '';
      }
      const relationship = this.selectedRelationship;
      if (relationship) this.cardinality = relationship.cardinality;
    }
  }

  sourceDetailsChanged(source: DatasetSource): boolean {
    return this.sourceCaption.trim() !== (source.caption ?? source.alias)
      || (this.sourceDescription.trim() || null) !== (source.description ?? null);
  }

  submitSourceDetails(source: DatasetSource): void {
    const caption = this.sourceCaption.trim();
    this.saveSourceDetails.emit({
      sourceId: source.id, caption: caption && caption !== source.alias ? caption : null, description: this.sourceDescription.trim() || null,
    });
  }

  parametersChanged(source: DatasetSource): boolean {
    return (source.parameters ?? []).some(p => (this.paramFields[p.name] || null) !== (p.field ?? null));
  }

  submitParameters(source: DatasetSource): void {
    this.saveParameters.emit({
      sourceId: source.id, bindings: (source.parameters ?? []).map(p => ({ name: p.name, field: this.paramFields[p.name] || null })),
    });
  }

  get detailsChanged(): boolean {
    return !!this.dataset && !!this.name.trim()
      && (this.name.trim() !== this.dataset.name || (this.description.trim() || null) !== (this.dataset.description ?? null));
  }

  submitDetails(): void {
    if (this.detailsChanged) this.saveDetails.emit({ name: this.name.trim(), description: this.description.trim() || null });
  }

  /** Where a table is read from: database, schema and table, or the view by name and id. */
  origin(source: DatasetSource): SourceOrigin {
    return sourceOrigin(source);
  }

  /** The model's tables grouped by the database they are read from, for the data model's properties. */
  get tablesByDatabase(): OriginGroup[] {
    return this.dataset ? originGroups(this.dataset) : [];
  }

  get selectedSource(): DatasetSource | undefined {
    const selection = this.selection;
    return selection?.kind === 'source' ? this.dataset?.sources.find(s => s.id === selection.id) : undefined;
  }

  /** Opens the relationship editor on the selected relationship. */
  @Output() editRelationship = new EventEmitter<DatasetRelationship>();

  get selectedRelationship(): DatasetRelationship | undefined {
    const selection = this.selection;
    return selection?.kind === 'relationship' ? this.dataset?.relationships.find(r => r.id === selection.id) : undefined;
  }

  get selectedMeasure(): DatasetMeasure | undefined {
    const selection = this.selection;
    return selection?.kind === 'measure' ? this.dataset?.measures.find(m => m.id === selection.id) : undefined;
  }

  get selectedColumn(): ColumnView | null {
    const selection = this.selection;
    if (selection?.kind !== 'column' || !this.dataset) return null;
    const source = this.dataset.sources.find(s => s.id === selection.sourceId);
    if (!source) return null;
    const stored = this.columnsOf(source).find(c => sameName(c.columnName, selection.column)) ?? null;
    const calculated = this.dataset.calculatedColumns.find(c => c.sourceId === source.id && sameName(c.name, selection.column)) ?? null;
    if (!stored && !calculated) return null;
    const dataType = stored?.dataType ?? calculated?.dataType ?? '';
    const links = this.dataset.relationships.flatMap(r => {
      if (r.fromSourceId === source.id && sameName(r.fromColumn, selection.column)) return [`Many to one ${this.aliasOf(r.toSourceId)}.${r.toColumn}`];
      if (r.toSourceId === source.id && sameName(r.toColumn, selection.column)) return [`One to many ${this.aliasOf(r.fromSourceId)}.${r.fromColumn}`];
      return [];
    });
    return {
      source, name: stored?.columnName ?? calculated!.name, dataType, kind: fieldKind(dataType), stored, calculated,
      transforms: this.dataset.transforms.filter(t => t.sourceId === source.id && sameName(t.column, selection.column)), links,
    };
  }

  /** Counts for the table card of the pane. */
  tableFacts(source: DatasetSource): { columns: number; calculated: number; transforms: number; measures: number; links: number } {
    const dataset = this.dataset;
    return {
      columns: this.columnsOf(source).length,
      calculated: dataset?.calculatedColumns.filter(c => c.sourceId === source.id).length ?? 0,
      transforms: dataset?.transforms.filter(t => t.sourceId === source.id).length ?? 0,
      measures: dataset?.measures.filter(m => m.homeSourceId === source.id).length ?? 0,
      links: dataset?.relationships.filter(r => r.fromSourceId === source.id || r.toSourceId === source.id).length ?? 0,
    };
  }

  /** The selected table's view no longer matches the SQL approved when it was added. */
  get viewSourceChanged(): boolean {
    return !!this.selectedSource?.viewChanged;
  }

  /** Update from view is offered only with model.studio modify permission. */
  get canUpdateView(): boolean {
    return this.viewSourceChanged && !this.readonly;
  }

  columnsOf(source: { schemaName: string; sourceName: string } | undefined): DbSchemaColumn[] {
    return source ? this.columns.get(tableKey(source.schemaName, source.sourceName)) ?? [] : [];
  }

  aliasOf(sourceId: number | null | undefined): string {
    return this.dataset?.sources.find(s => s.id === sourceId)?.alias ?? '?';
  }

  formulaText(node: DatasetMeasure['expression']): string {
    return node ? printMeasure(node) : 'This formula cannot be read. Open it to write it again.';
  }

  describe(node: DatasetMeasure['expression']): string {
    return describeMeasure(node);
  }

  transformText(transform: DatasetTransform): string {
    return describeTransform(transform);
  }

  submitRls(): void {
    const source = this.selectedSource;
    if (!source || (this.rlsMode === 'plant' && !this.rlsColumn)) return;
    this.saveRls.emit({
      sourceId: source.id,
      body: { rlsMode: this.rlsMode, rlsPlantColumn: this.rlsMode === 'plant' ? this.rlsColumn : null },
    });
  }

  submitCardinality(): void {
    const relationship = this.selectedRelationship;
    if (relationship) this.saveCardinality.emit({ relationshipId: relationship.id, cardinality: this.cardinality });
  }
}
