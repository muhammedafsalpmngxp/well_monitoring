"""Generates add-marketplace-plugins.sql: the core.MarketplacePlugins table and its seed rows, one
per Highcharts chart type that draws from one category (dimension) and one measure. These rows
are the built-in "TWise Visuals" marketplace, served by GET /api/marketplace/catalog.

Run after editing CHARTS, then apply the SQL to each tenant database (idempotent)."""
import json
from pathlib import Path

ROLES = [
    {"key": "category", "label": "Category", "type": "dimension", "required": True, "allowMultiple": False},
    {"key": "measure", "label": "Measure", "type": "measure", "required": True, "allowMultiple": False},
]
BASE = {"backgroundColor": "transparent"}
XAXIS = {"categories": "{{category}}"}
YAXIS = {"title": {"text": None}}
NO_LEGEND = {"enabled": False}
SERIES_NAME = "{{measure.label}}"


def cartesian(kind, icon, desc, series=None, chart=None, xaxis=None, yaxis=None):
    return icon, desc, {
        "chart": {**BASE, "type": kind, **(chart or {})},
        "xAxis": {**XAXIS, **(xaxis or {})},
        "yAxis": {**YAXIS, **(yaxis or {})},
        "legend": NO_LEGEND,
        "series": [{"type": kind, "name": SERIES_NAME, **(series or {})}],
    }


def slices(kind, icon, desc, series=None):
    return icon, desc, {
        "chart": {**BASE, "type": kind},
        "legend": {"enabled": True},
        "plotOptions": {kind: {"dataLabels": {"enabled": True, "format": "{point.name}: {point.y}"}}},
        "series": [{"type": kind, "name": SERIES_NAME, **(series or {})}],
    }


# (id, name, icon, description, template)
CHARTS = [
    ("column", "Column", *cartesian("column", "bar", "Vertical bars, one per category.")),
    ("bar", "Bar", *cartesian("bar", "bar", "Horizontal bars, easier to read with long category names.")),
    ("line", "Line", *cartesian("line", "line", "Straight segments between points, for trends over an ordered axis.")),
    ("spline", "Spline", *cartesian("spline", "line", "Smoothed line through the points.")),
    ("step-line", "Step Line", *cartesian("line", "line", "Holds each value until the next category, for stepwise quantities.",
                                          series={"step": "center", "marker": {"enabled": True, "radius": 3}})),
    ("area", "Area", *cartesian("area", "area", "Line with the region below it filled.", series={"fillOpacity": 0.3})),
    ("spline-area", "Spline Area", *cartesian("areaspline", "area", "Smoothed area curve, for quantities that change continuously.",
                                              series={"fillOpacity": 0.3})),
    ("step-area", "Step Area", *cartesian("area", "area", "Filled stepwise area.", series={"step": "center", "fillOpacity": 0.3})),
    ("scatter", "Scatter", *cartesian("scatter", "scatter", "One marker per category, no connecting line.",
                                      series={"marker": {"radius": 5}})),
    ("lollipop", "Lollipop", "bar", "Thin stems with a marker on top; a lighter alternative to columns.", {
        "chart": {**BASE, "type": "column"},
        "xAxis": XAXIS, "yAxis": YAXIS, "legend": NO_LEGEND,
        "series": [
            {"type": "column", "name": SERIES_NAME, "pointWidth": 2, "borderWidth": 0},
            {"type": "scatter", "name": SERIES_NAME, "marker": {"radius": 6, "symbol": "circle"}, "showInLegend": False},
        ],
    }),
    ("waterfall", "Waterfall", *cartesian("waterfall", "bar", "Running total, showing how each category adds to or subtracts from it.",
                                          series={"dataLabels": {"enabled": True}})),
    ("radar", "Radar", "line", "Compares one measure across categories on a closed loop.", {
        "chart": {**BASE, "polar": True, "type": "area"},
        "xAxis": {**XAXIS, "tickmarkPlacement": "on", "lineWidth": 0},
        "yAxis": {"gridLineInterpolation": "polygon", "lineWidth": 0, "min": 0},
        "legend": NO_LEGEND,
        "series": [{"type": "area", "name": SERIES_NAME, "pointPlacement": "on", "fillOpacity": 0.3}],
    }),
    ("polar-column", "Polar Column", "bar", "Columns arranged around a circle (wind rose).", {
        "chart": {**BASE, "polar": True, "type": "column"},
        "xAxis": {**XAXIS, "tickmarkPlacement": "on"},
        "yAxis": {"min": 0, "endOnTick": False},
        "legend": NO_LEGEND,
        "series": [{"type": "column", "name": SERIES_NAME, "pointPadding": 0, "groupPadding": 0}],
    }),
    ("radial-bar", "Radial Bar", "bar", "Concentric bars, one ring per category.", {
        "chart": {**BASE, "polar": True, "type": "column", "inverted": True},
        "pane": {"size": "85%", "innerSize": "20%", "endAngle": 270},
        "xAxis": {**XAXIS, "tickInterval": 1, "lineWidth": 0, "gridLineWidth": 0},
        "yAxis": {"lineWidth": 0, "tickInterval": 25, "reversedStacks": False, "endOnTick": True, "showLastLabel": True},
        "legend": NO_LEGEND,
        "series": [{"type": "column", "name": SERIES_NAME, "borderWidth": 0, "borderRadius": "50%", "pointPadding": 0, "groupPadding": 0.15}],
    }),
    ("pie", "Pie", *slices("pie", "pie", "Share of the whole per category.")),
    ("donut", "Donut", *slices("pie", "pie", "Pie with a hollow centre.", series={"innerSize": "60%"})),
    ("semi-donut", "Semi-circle Donut", *slices("pie", "pie", "Half donut, saves vertical space.",
                                                series={"innerSize": "55%", "startAngle": -90, "endAngle": 90, "center": ["50%", "75%"], "size": "110%"})),
    ("funnel", "Funnel", *slices("funnel", "bar", "Stages narrowing from top to bottom, for conversion pipelines.",
                                 series={"neckWidth": "30%", "neckHeight": "25%"})),
    ("pyramid", "Pyramid", *slices("pyramid", "bar", "Stages widening from top to bottom.")),
    # ── Added for parity with DataTeaCup's chart set; each still binds one category + one measure.
    ("word-cloud", "Word Cloud", "pie", "Category labels sized by the measure; the biggest words carry the biggest values.", {
        "chart": {**BASE},
        "legend": NO_LEGEND,
        "series": [{"type": "wordcloud", "name": SERIES_NAME, "rotation": {"from": 0, "to": 0}, "minFontSize": 10}],
    }),
    ("packed-bubble", "Packed Bubble", "pie", "Bubbles sized by the measure and packed together, one per category.", {
        "chart": {**BASE, "type": "packedbubble"},
        "legend": NO_LEGEND,
        "plotOptions": {"packedbubble": {"minSize": "20%", "maxSize": "100%", "layoutAlgorithm": {"gravitationalConstant": 0.05, "splitSeries": False},
                                         "dataLabels": {"enabled": True, "format": "{point.name}"}}},
        "series": [{"type": "packedbubble", "name": SERIES_NAME}],
    }),
    ("item", "Item Chart", "pie", "Parliament-style dots, one per unit of the measure, coloured by category.", {
        "chart": {**BASE, "type": "item"},
        "legend": {"enabled": True},
        "series": [{"type": "item", "name": SERIES_NAME, "startAngle": -100, "endAngle": 100, "center": ["50%", "88%"], "size": "170%", "innerSize": "20%"}],
    }),
    ("variable-pie", "Variable Radius Pie", "pie", "Pie whose slice radius also follows the measure, so big values stand out twice.", {
        "chart": {**BASE, "type": "variablepie"},
        "legend": {"enabled": True},
        "series": [{"type": "variablepie", "name": SERIES_NAME, "minPointSize": 10, "innerSize": "20%", "zMin": 0}],
    }),
    ("sunburst", "Sunburst", "pie", "Ring of segments sized by the measure; a compact alternative to a pie.", {
        "chart": {**BASE},
        "legend": NO_LEGEND,
        "series": [{"type": "sunburst", "name": SERIES_NAME, "allowDrillToNode": False, "dataLabels": {"format": "{point.name}"}, "levels": [{"level": 1, "colorByPoint": True}]}],
    }),
    ("column-pyramid", "Column Pyramid", "bar", "Triangular columns, one per category.", {
        "chart": {**BASE, "type": "columnpyramid"},
        "xAxis": XAXIS, "yAxis": YAXIS, "legend": NO_LEGEND,
        "series": [{"type": "columnpyramid", "name": SERIES_NAME, "colorByPoint": True}],
    }),
    ("pareto", "Pareto", "bar", "Columns sorted by value with a cumulative percentage line, for the 80/20 view.", {
        "chart": {**BASE, "type": "column"},
        "xAxis": XAXIS,
        "yAxis": [YAXIS, {"title": {"text": None}, "min": 0, "max": 100, "opposite": True, "labels": {"format": "{value}%"}}],
        "legend": NO_LEGEND,
        "series": [
            {"type": "column", "name": SERIES_NAME},
            {"type": "pareto", "name": "Cumulative %", "yAxis": 1, "baseSeries": 0, "zIndex": 10, "tooltip": {"valueDecimals": 1, "valueSuffix": "%"}},
        ],
    }),
]

FEATURES = {
    "word-cloud": ["Words sized by value", "No axes to read", "Best for names, tags and categories"],
    "packed-bubble": ["Bubble area = value", "Labels inside bubbles", "Good for 5–40 categories"],
    "item": ["One dot per unit", "Parliament layout", "Best for small counts such as seats or headcount"],
    "variable-pie": ["Slice angle and radius follow the value", "Legend", "Highlights outliers"],
    "sunburst": ["Ring of segments", "Compact", "Labels on segments"],
    "column-pyramid": ["Triangular columns", "Colour per category", "Eye-catching for a few categories"],
    "pareto": ["Sorted columns", "Cumulative % line on a second axis", "80/20 analysis"],
    "column": ["Vertical bars", "Value labels on hover", "Best for up to ~20 categories"],
    "bar": ["Horizontal bars", "Readable long labels", "Ranks categories top to bottom"],
    "line": ["Trend over an ordered axis", "Point markers", "Works with sparse data"],
    "spline": ["Smoothed curve", "Point markers", "Emphasises the overall trend"],
    "step-line": ["Holds value between categories", "Point markers", "For stepwise quantities such as rates"],
    "area": ["Filled trend", "Emphasises volume", "Semi-transparent fill"],
    "spline-area": ["Smoothed filled curve", "Emphasises volume", "Semi-transparent fill"],
    "step-area": ["Stepwise filled area", "For quantities that hold between readings"],
    "scatter": ["One marker per category", "No connecting line", "Highlights outliers"],
    "lollipop": ["Thin stems with a marker", "Less ink than columns", "Good for many categories"],
    "waterfall": ["Running total", "Positive and negative steps", "Value labels"],
    "radar": ["Closed-loop comparison", "Polygon grid", "Shape shows the profile"],
    "polar-column": ["Columns around a circle", "Wind-rose style", "Cyclic categories"],
    "radial-bar": ["Concentric bars", "One ring per category", "Rounded bar ends"],
    "pie": ["Share of the whole", "Named slices", "Legend"],
    "donut": ["Share of the whole", "Hollow centre for a KPI", "Legend"],
    "semi-donut": ["Half-circle layout", "Saves vertical space", "Legend"],
    "funnel": ["Narrowing stages", "Conversion pipelines", "Slice labels"],
    "pyramid": ["Widening stages", "Hierarchies and populations", "Slice labels"],
}

VERSION = "1.0.0"
PUBLISHER = "TWise"

TABLE = """/* ============================================================================
   core.MarketplacePlugins -- the built-in "TWise Visuals" marketplace.

   Served as a catalog by GET /api/marketplace/catalog and browsed under the
   catalog key 'twise'. Also receives metadata imported from .pbiviz packages
   (render_kind = pbiviz). Generated by infra/sql/build-marketplace-plugins.py;
   edit the generator, not this file.

   Idempotent: safe to re-run. Existing rows are updated by plugin_id.
   ============================================================================ */
IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO
IF OBJECT_ID(N'core.MarketplacePlugins', N'U') IS NULL
CREATE TABLE core.MarketplacePlugins (
    id                     bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_MarketplacePlugins PRIMARY KEY,
    plugin_id              nvarchar(100)  NOT NULL,
    name                   nvarchar(100)  NOT NULL,
    description            nvarchar(1000) NOT NULL,
    version                nvarchar(20)   NOT NULL,
    publisher              nvarchar(100)  NOT NULL,
    visual_key             nvarchar(100)  NOT NULL,
    render_kind            nvarchar(50)   NOT NULL,
    icon                   nvarchar(50)   NULL,
    data_roles_json        nvarchar(max)  NOT NULL,
    features_json          nvarchar(max)  NULL,
    image_url              nvarchar(max)  NULL,
    options_template_json  nvarchar(max)  NOT NULL,
    is_active              bit            NOT NULL CONSTRAINT DF_core_MarketplacePlugins_is_active DEFAULT 1,
    created_at             datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplacePlugins_created_at DEFAULT SYSUTCDATETIME(),
    modified_at            datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplacePlugins_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_MarketplacePlugins_plugin_id')
    CREATE UNIQUE INDEX UX_core_MarketplacePlugins_plugin_id ON core.MarketplacePlugins (plugin_id);
GO
"""

UPSERT = """IF EXISTS (SELECT 1 FROM core.MarketplacePlugins WHERE plugin_id = {pid})
    UPDATE core.MarketplacePlugins SET name = {name}, description = {desc}, version = {ver}, publisher = {pub},
        visual_key = {vkey}, render_kind = N'highcharts-template', icon = {icon}, data_roles_json = {roles},
        features_json = {features}, options_template_json = {tpl}, modified_at = SYSUTCDATETIME()
    WHERE plugin_id = {pid};
ELSE
    INSERT INTO core.MarketplacePlugins (plugin_id, name, description, version, publisher, visual_key, render_kind, icon, data_roles_json, features_json, options_template_json)
    VALUES ({pid}, {name}, {desc}, {ver}, {pub}, {vkey}, N'highcharts-template', {icon}, {roles}, {features}, {tpl});
"""


def lit(value) -> str:
    """T-SQL nvarchar literal."""
    text = value if isinstance(value, str) else json.dumps(value, separators=(",", ":"))
    return "N'" + text.replace("'", "''") + "'"


rows = [
    UPSERT.format(pid=lit(pid), name=lit(name), desc=lit(desc), ver=lit(VERSION), pub=lit(PUBLISHER),
                  vkey=lit(f"{pid}-mkt"), icon=lit(icon), roles=lit(ROLES), features=lit(FEATURES[pid]), tpl=lit(template))
    for pid, name, icon, desc, template in CHARTS
]

out = Path(__file__).with_name("add-marketplace-plugins.sql")
out.write_text(TABLE + "\n".join(rows) + "GO\n", encoding="utf-8")
print(f"{len(CHARTS)} plugins -> {out}")
