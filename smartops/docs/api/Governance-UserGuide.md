# Data Governance — User Facing API Documentation

Base URL: `{tenantApiUrl}/api/governance` · All endpoints need a tenant JWT.

Governance in TWise has three parts:

| Part | Where | What it gives you |
|---|---|---|
| **Data quality** | Data Quality → Error Log & Rules (`/api/data-quality`, existing) | Validation rules run against tables and views; failures land in the error log |
| **Data dictionary** | Data Quality → Data Dictionary | Business names, descriptions, owners, sensitivity and tags for every column of every imported dataset and database view |
| **Data lineage** | Data Quality → Data Lineage | The source → dataset → chart → dashboard/report graph, traceable up- and downstream from any node |

---

## 1. Data dictionary

Datasets are discovered automatically: every completed import and every database view of the tenant.
Their technical columns come from the dataset; you only add the documentation.

### `GET /dictionary`

Lists the datasets with coverage counts.

```json
[
  { "kind": "import", "id": 53, "name": "Product Orders", "description": null, "owner": "Sales Ops",
    "columnCount": 9, "documentedCount": 4, "piiCount": 1 },
  { "kind": "view", "id": 12, "name": "Well production daily", "description": "...", "owner": null,
    "columnCount": 6, "documentedCount": 6, "piiCount": 0 }
]
```

`kind` is `import` or `view`. `documentedCount` counts columns that have a description.

### `GET /dictionary/{kind}/{id}`

One dataset with its columns merged with their documentation. Columns without an entry come back with
empty documentation and `sensitivity: "internal"`.

```json
{
  "kind": "import", "id": 53, "name": "Product Orders", "description": null, "owner": "Sales Ops",
  "columns": [
    { "columnName": "customer_email", "dataType": "string", "businessName": "Customer e-mail",
      "description": "Contact address captured at checkout", "owner": null, "sensitivity": "pii", "tags": "contact,crm" },
    { "columnName": "amount", "dataType": "number", "businessName": null, "description": null,
      "owner": null, "sensitivity": "internal", "tags": null }
  ]
}
```

`dataType` is `string | number | boolean | date` for imports and empty for views (the view's SQL decides).

### `PUT /dictionary/{kind}/{id}`

Saves the dataset description and owner, and the documentation of every column in the body.
Columns you leave out are untouched; column names that do not exist on the dataset are ignored.

```json
{
  "description": "One row per order line",
  "owner": "Sales Ops",
  "columns": [
    { "columnName": "customer_email", "businessName": "Customer e-mail", "description": "...",
      "owner": null, "sensitivity": "pii", "tags": "contact,crm" }
  ]
}
```

`sensitivity` is one of `public | internal | confidential | pii`; anything else is stored as `internal`.
Returns the same shape as `GET`. `404` when the dataset does not exist for the tenant.

---

## 2. Data lineage

### `GET /lineage`

The whole graph for the tenant. Nothing is configured by hand: edges come from the relationships the
app already stores (a view's connection, a chart's dataset, a dashboard's charts…).

```json
{
  "nodes": [
    { "id": "db:3",        "kind": "db",        "label": "Reporting Postgres", "sub": "postgres · reporting" },
    { "id": "view:12",     "kind": "view",      "label": "Well production daily", "sub": null },
    { "id": "import:53",   "kind": "import",    "label": "Product Orders", "sub": "csv · 1200 rows" },
    { "id": "chart:88",    "kind": "chart",     "label": "Orders by region", "sub": "chart" },
    { "id": "dashboard:5", "kind": "dashboard", "label": "Sales overview", "sub": "Published" }
  ],
  "edges": [
    { "from": "db:3", "to": "view:12" },
    { "from": "import:53", "to": "chart:88" },
    { "from": "chart:88", "to": "dashboard:5" }
  ]
}
```

Node kinds and what feeds what:

| Kind | Node | Feeds |
|---|---|---|
| `source` | Google Sheets / Drive / REST connection | the imports fetched from it |
| `db` | live database connection | its database views |
| `import` | imported dataset | charts and tiles built on it |
| `view` | database view | other views that reference it (CTEs, components), charts, reports |
| `table` | a core table used directly by name | charts, reports |
| `chart` | chart or tile | dashboards; a tile also feeds the chart it is attached to |
| `dashboard` | latest published version, or an unpublished draft | — |
| `report` | report | — |

The Lineage page lays the graph out in four columns and, on click, highlights everything upstream and
downstream of the node, with both lists in the side panel.

---

## Permissions

| Page | Module code |
|---|---|
| Data Dictionary | `data-quality.data-dictionary` |
| Data Lineage | `data-quality.lineage` (new; admins have it by default) |

## Common errors

| Status | Meaning |
|---|---|
| 401 | Missing tenant or user claim |
| 404 | Dataset not found for the tenant, or unknown `kind` |
