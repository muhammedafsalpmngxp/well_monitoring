"""Generates add-marketplace-plugins.sql: the core.MarketplacePlugins table and its seed rows, one
per Highcharts chart type. Most draw from one category (dimension) and one measure; multi-role
charts (MULTI_CHARTS) declare their own roles and are bound against the rows. These rows
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


def role(key, label, kind="measure", required=True, multiple=False):
    return {"key": key, "label": label, "type": kind, "required": required, "allowMultiple": multiple}


CATEGORY = role("category", "Category", "dimension")
SPLIT = role("split", "Split By", "dimension")
MEASURE = role("measure", "Measure")
LEGEND = {"enabled": True}

# Multi-role charts: (id, name, icon, description, template, roles). A series without data is filled
# from the mapped columns: one series per split value / measure, X/Y points, OHLC rows or level nodes.
MULTI_CHARTS = [
    ("line-by-group", "Line by Group", "line", "One line per value of a split-by column, e.g. output per cluster over months.", {
        "chart": {**BASE, "type": "line"}, "xAxis": XAXIS, "yAxis": YAXIS, "legend": LEGEND,
        "series": [{"type": "line", "marker": {"radius": 3}}],
    }, [CATEGORY, SPLIT, MEASURE]),
    ("stacked-column-group", "Stacked Column by Group", "bar", "Columns per category, stacked by the values of a split-by column.", {
        "chart": {**BASE, "type": "column"}, "xAxis": XAXIS, "yAxis": {**YAXIS, "stackLabels": {"enabled": True}}, "legend": LEGEND,
        "plotOptions": {"column": {"stacking": "normal"}},
        "series": [{"type": "column"}],
    }, [CATEGORY, SPLIT, MEASURE]),
    ("stacked-area", "Stacked Area", "area", "Several measures stacked on top of each other, showing the total and each part.", {
        "chart": {**BASE, "type": "area"}, "xAxis": XAXIS, "yAxis": YAXIS, "legend": LEGEND,
        "plotOptions": {"area": {"stacking": "normal", "fillOpacity": 0.5}},
        "series": [{"type": "area"}],
    }, [CATEGORY, role("measures", "Measures", multiple=True)]),
    ("dual-axis", "Column + Line (Dual Axis)", "bar", "A measure as columns and a second measure as a line on its own right-hand axis.", {
        "chart": {**BASE}, "xAxis": XAXIS, "legend": LEGEND,
        "yAxis": [{"title": {"text": "{{measure.label}}"}}, {"title": {"text": "{{measure2.label}}"}, "opposite": True}],
        "series": [
            {"type": "column", "name": "{{measure.label}}", "data": "{{measure}}"},
            {"type": "spline", "name": "{{measure2.label}}", "data": "{{measure2}}", "yAxis": 1, "marker": {"radius": 3}},
        ],
    }, [CATEGORY, role("measure", "Column Measure"), role("measure2", "Line Measure")]),
    ("xy-scatter", "X/Y Scatter", "scatter", "One marker per row at its numeric X and Y; optional colour scale and labels.", {
        "chart": {**BASE, "type": "scatter", "zooming": {"type": "xy"}},
        "xAxis": {"title": {"text": "{{x.label}}"}}, "yAxis": {"title": {"text": "{{y.label}}"}},
        "colorAxis": {"minColor": "#cfe8e1", "maxColor": "#127a65"}, "legend": NO_LEGEND,
        "series": [{"type": "scatter", "name": "{{y.label}}", "colorKey": "colorValue", "marker": {"radius": 5}}],
    }, [role("x", "X"), role("y", "Y"), role("color", "Color", required=False), role("label", "Label", "dimension", required=False)]),
    ("xy-bubble", "X/Y Bubble", "scatter", "Scatter whose marker size follows a third measure; optional colour scale.", {
        "chart": {**BASE, "type": "bubble", "zooming": {"type": "xy"}},
        "xAxis": {"title": {"text": "{{x.label}}"}}, "yAxis": {"title": {"text": "{{y.label}}"}},
        "colorAxis": {"minColor": "#cfe8e1", "maxColor": "#127a65"}, "legend": NO_LEGEND,
        "series": [{"type": "bubble", "name": "{{size.label}}", "colorKey": "colorValue", "minSize": 6, "maxSize": "18%"}],
    }, [role("x", "X"), role("y", "Y"), role("size", "Size"), role("color", "Color", required=False), role("label", "Label", "dimension", required=False)]),
    ("xy-line", "X/Y Line", "line", "Points joined in order of a numeric (or date) X, for measured curves.", {
        "chart": {**BASE, "type": "line", "zooming": {"type": "x"}},
        "xAxis": {"title": {"text": "{{x.label}}"}}, "yAxis": {"title": {"text": "{{y.label}}"}}, "legend": NO_LEGEND,
        "series": [{"type": "line", "name": "{{y.label}}", "marker": {"radius": 3}}],
    }, [role("x", "X"), role("y", "Y"), role("label", "Label", "dimension", required=False)]),
    ("ohlc", "OHLC", "line", "Open, high, low and close per date as bars with ticks.", {
        "chart": {**BASE}, "xAxis": {"type": "datetime"}, "yAxis": YAXIS, "legend": NO_LEGEND,
        "series": [{"type": "ohlc", "name": "{{close.label}}"}],
    }, [role("date", "Date", "dimension"), role("open", "Open"), role("high", "High"), role("low", "Low"), role("close", "Close")]),
    ("sunburst-levels", "Multi-level Sunburst", "pie", "Rings for each level of a hierarchy (e.g. cluster > plant > well), sized by a measure.", {
        "chart": {**BASE}, "legend": NO_LEGEND,
        "series": [{"type": "sunburst", "name": "{{measure.label}}", "allowTraversingTree": True, "dataLabels": {"format": "{point.name}"},
                    "levels": [{"level": 1, "colorByPoint": True}, {"level": 2, "colorVariation": {"key": "brightness", "to": -0.4}},
                               {"level": 3, "colorVariation": {"key": "brightness", "to": 0.4}}]}],
    }, [role("levels", "Levels (in order)", "dimension", multiple=True), MEASURE]),
    ("treemap-levels", "Multi-level Treemap", "bar", "Nested rectangles for each level of a hierarchy, sized by a measure.", {
        "chart": {**BASE}, "legend": NO_LEGEND,
        "series": [{"type": "treemap", "name": "{{measure.label}}", "layoutAlgorithm": "squarified", "allowTraversingTree": True,
                    "levels": [{"level": 1, "colorByPoint": True, "borderWidth": 3, "dataLabels": {"enabled": True, "style": {"fontSize": "13px"}}},
                               {"level": 2, "borderWidth": 1, "dataLabels": {"enabled": False}}]}],
    }, [role("levels", "Levels (in order)", "dimension", multiple=True), MEASURE]),
    ("density", "Density", "scatter", "Rows grouped into a grid over numeric X and Y; each cell coloured by the row count or a weight.", {
        "chart": {**BASE, "type": "heatmap", "zooming": {"type": "xy"}},
        "xAxis": {"title": {"text": "{{x.label}}"}}, "yAxis": {"title": {"text": "{{y.label}}"}},
        "colorAxis": {"min": 0, "minColor": "#eef7f4", "maxColor": "#127a65"},
        "legend": {"enabled": True, "title": {"text": "Rows / Weight"}},
        "series": [{"type": "heatmap", "name": "{{y.label}}", "borderWidth": 0}],
    }, [role("x", "X"), role("y", "Y"), role("weight", "Weight", required=False)]),
    ("map-density", "Map Density", "line", "Heat layer over a street map: rows grouped by latitude and longitude, coloured by count or a weight.", {
        "chart": {**BASE},
        "credits": {"enabled": True, "text": "© OpenStreetMap contributors", "href": "https://www.openstreetmap.org/copyright"},
        "mapView": {"projection": {"name": "WebMercator"}, "padding": 30, "maxZoom": 14},
        "mapNavigation": {"enabled": True, "enableMouseWheelZoom": True, "buttonOptions": {"verticalAlign": "bottom"}},
        "colorAxis": {"min": 0, "minColor": "#fff3b0", "maxColor": "#d7191c"},
        "legend": {"enabled": True, "title": {"text": "Rows / Weight"}},
        "series": [
            {"type": "tiledwebmap", "name": "Map", "provider": {"type": "OpenStreetMap"}, "showInLegend": False},
            {"type": "geoheatmap", "name": "{{latitude.label}}", "opacity": 0.75},
        ],
    }, [role("latitude", "Latitude"), role("longitude", "Longitude"), role("weight", "Weight", required=False)]),
    ("sunburst-color", "Sunburst - Color by Value", "pie", "Multi-level sunburst sized by one measure and coloured on a scale by another.", {
        "chart": {**BASE}, "colorAxis": {"minColor": "#e8f1fb", "maxColor": "#21409a"}, "legend": {"enabled": True, "title": {"text": "{{color.label}}"}},
        "series": [{"type": "sunburst", "name": "{{measure.label}}", "colorKey": "colorValue", "allowTraversingTree": True, "dataLabels": {"format": "{point.name}"}}],
    }, [role("levels", "Levels (in order)", "dimension", multiple=True), role("measure", "Size"), role("color", "Color")]),
    ("treemap-color", "Treemap - Color by Value", "bar", "Multi-level treemap sized by one measure and coloured on a scale by another.", {
        "chart": {**BASE}, "colorAxis": {"minColor": "#e8f1fb", "maxColor": "#21409a"}, "legend": {"enabled": True, "title": {"text": "{{color.label}}"}},
        "series": [{"type": "treemap", "name": "{{measure.label}}", "colorKey": "colorValue", "layoutAlgorithm": "squarified", "allowTraversingTree": True,
                    "levels": [{"level": 1, "borderWidth": 3, "dataLabels": {"enabled": True, "style": {"fontSize": "13px"}}},
                               {"level": 2, "borderWidth": 1, "dataLabels": {"enabled": False}}]}],
    }, [role("levels", "Levels (in order)", "dimension", multiple=True), role("measure", "Size"), role("color", "Color")]),
    ("sunburst-group", "Sunburst by Group", "pie", "One small sunburst per value of a split-by column, side by side for comparison (up to 9); optional colour by value.", {
        "chart": {**BASE}, "legend": NO_LEGEND, "colorAxis": {"minColor": "#e8f1fb", "maxColor": "#21409a"},
        "series": [{"type": "sunburst", "allowTraversingTree": True, "dataLabels": {"format": "{point.name}", "style": {"fontSize": "9px"}},
                    "levels": [{"level": 1, "colorByPoint": True}, {"level": 2, "colorVariation": {"key": "brightness", "to": -0.4}}]}],
    }, [role("levels", "Levels (in order)", "dimension", multiple=True), SPLIT, MEASURE, role("color", "Color", required=False)]),
    ("category-heatmap", "Category Heatmap", "bar", "A grid of one category against another, each cell coloured by a measure.", {
        "chart": {**BASE, "type": "heatmap"},
        "xAxis": {"categories": "{{category}}"}, "yAxis": {"categories": "{{row}}", "title": {"text": None}, "reversed": True},
        "colorAxis": {"minColor": "#e8f1fb", "maxColor": "#21409a"}, "legend": {"enabled": True, "title": {"text": "{{measure.label}}"}},
        "series": [{"type": "heatmap", "name": "{{measure.label}}", "borderWidth": 1, "borderColor": "#ffffff"}],
    }, [CATEGORY, role("row", "Rows", "dimension"), MEASURE]),
    # ── Group By / bar variants ──
    ("stacked-bar-group", "Stacked Bar by Group", "bar", "Horizontal bars per category, stacked by the values of a split-by column.", {
        "chart": {**BASE, "type": "bar"}, "xAxis": XAXIS, "yAxis": {**YAXIS, "stackLabels": {"enabled": True}}, "legend": LEGEND,
        "plotOptions": {"bar": {"stacking": "normal"}}, "series": [{"type": "bar"}],
    }, [CATEGORY, SPLIT, MEASURE]),
    ("column-two-groups", "Column by Two Groups", "bar", "Columns for each combination of two (or more) group columns, e.g. Category > Sub-Category, largest first.", {
        "chart": {**BASE, "type": "column"}, "xAxis": {"categories": "{{groups}}"}, "yAxis": YAXIS, "legend": NO_LEGEND,
        "tw": {"sort": "desc"}, "series": [{"type": "column", "name": "{{measure.label}}"}],
    }, [role("groups", "Groups (in order)", "dimension", multiple=True), MEASURE]),
    ("sorted-bar", "Sorted Bar", "bar", "Horizontal bars sorted largest first; optionally stacked by a split-by column.", {
        "chart": {**BASE, "type": "bar"}, "xAxis": XAXIS, "yAxis": YAXIS, "legend": LEGEND,
        "plotOptions": {"bar": {"stacking": "normal"}}, "tw": {"sort": "desc"}, "series": [{"type": "bar", "name": "{{measure.label}}"}],
    }, [CATEGORY, MEASURE, role("split", "Split By", "dimension", required=False)]),
    ("diverging-bar", "Diverging Bar", "bar", "Bars left and right of zero, coloured by sign (e.g. profit vs loss), sorted.", {
        "chart": {**BASE, "type": "bar"}, "xAxis": XAXIS, "yAxis": {**YAXIS, "plotLines": [{"value": 0, "width": 1, "color": "#667085"}]},
        "legend": NO_LEGEND, "tw": {"sort": "desc"},
        "series": [{"type": "bar", "name": "{{measure.label}}", "color": "#2c7bb6", "negativeColor": "#d7191c"}],
    }, [CATEGORY, MEASURE, role("split", "Split By", "dimension", required=False)]),
    ("dual-axis-columns", "Two Columns (Dual Axis)", "bar", "Two measures as side-by-side columns, the second on its own right-hand axis.", {
        "chart": {**BASE, "type": "column"}, "xAxis": XAXIS, "legend": LEGEND,
        "yAxis": [{"title": {"text": "{{measure.label}}"}}, {"title": {"text": "{{measure2.label}}"}, "opposite": True}],
        "series": [{"type": "column", "name": "{{measure.label}}", "data": "{{measure}}"},
                   {"type": "column", "name": "{{measure2.label}}", "data": "{{measure2}}", "yAxis": 1}],
    }, [CATEGORY, role("measure", "Left Measure"), role("measure2", "Right Measure")]),
    # ── Market ──
    ("price-candlestick", "Price Candlestick", "line", "Candles built from a price and a time column: open, high, low and close per time bucket.", {
        "chart": {**BASE}, "xAxis": {"type": "datetime"}, "yAxis": {"title": {"text": "{{price.label}}"}}, "legend": NO_LEGEND,
        "series": [{"type": "candlestick", "name": "{{price.label}}", "color": "#d7191c", "upColor": "#2c7bb6", "lineColor": "#667085", "upLineColor": "#667085"}],
    }, [role("date", "Time", "dimension"), role("price", "Price")]),
    ("order-book", "Order Book", "bar", "Price buckets with one side (e.g. buy) to the left and the other (sell) to the right.", {
        "chart": {**BASE, "type": "bar"}, "xAxis": {"title": {"text": "{{price.label}}"}, "reversed": False},
        "yAxis": {**YAXIS, "plotLines": [{"value": 0, "width": 1, "color": "#667085"}]}, "legend": LEGEND,
        "plotOptions": {"bar": {"stacking": "normal", "groupPadding": 0, "pointPadding": 0.05}}, "tw": {"negateFirstSplit": True},
        "series": [{"type": "bar"}],
    }, [role("price", "Price"), role("split", "Side", "dimension"), role("weight", "Weight", required=False)]),
    ("xy-scatter-group", "X/Y Scatter by Group", "scatter", "Scatter with one colour per value of a split-by column (e.g. order status).", {
        "chart": {**BASE, "type": "scatter", "zooming": {"type": "xy"}},
        "xAxis": {"title": {"text": "{{x.label}}"}}, "yAxis": {"title": {"text": "{{y.label}}"}}, "legend": LEGEND,
        "series": [{"type": "scatter", "marker": {"radius": 4, "symbol": "circle"}}],
    }, [role("x", "X"), role("y", "Y"), SPLIT, role("size", "Size", required=False), role("label", "Label", "dimension", required=False)]),
    ("xy-scatter-labels", "X/Y Scatter - Labels", "scatter", "Scatter with each point labelled (e.g. by sub-category); optional colour scale.", {
        "chart": {**BASE, "type": "scatter", "zooming": {"type": "xy"}},
        "xAxis": {"title": {"text": "{{x.label}}"}}, "yAxis": {"title": {"text": "{{y.label}}"}},
        "colorAxis": {"minColor": "#cfe8e1", "maxColor": "#127a65"}, "legend": NO_LEGEND,
        "series": [{"type": "scatter", "name": "{{y.label}}", "colorKey": "colorValue", "marker": {"radius": 5},
                    "dataLabels": {"enabled": True, "format": "{point.name}", "style": {"fontSize": "10px", "textOutline": "none"}}}],
    }, [role("x", "X"), role("y", "Y"), role("label", "Label", "dimension"), role("color", "Color", required=False)]),
    # ── Treemap / Heatmap variants ──
    ("treemap-group", "Treemap by Group", "bar", "Treemap whose top level is a split-by column (e.g. Region), one colour per group.", {
        "chart": {**BASE}, "legend": NO_LEGEND,
        "series": [{"type": "treemap", "name": "{{measure.label}}", "layoutAlgorithm": "squarified", "allowTraversingTree": True,
                    "levels": [{"level": 1, "colorByPoint": True, "borderWidth": 3, "dataLabels": {"enabled": True, "style": {"fontSize": "13px"}}},
                               {"level": 2, "borderWidth": 1, "dataLabels": {"enabled": False}}]}],
    }, [role("levels", "Levels (in order)", "dimension", multiple=True), SPLIT, MEASURE]),
    ("diverging-heatmap", "Diverging Heatmap", "bar", "Category x category grid on a red-white-blue scale centred on zero (e.g. profit vs loss).", {
        "chart": {**BASE, "type": "heatmap"},
        "xAxis": {"categories": "{{category}}"}, "yAxis": {"categories": "{{row}}", "title": {"text": None}, "reversed": True},
        "colorAxis": {"stops": [[0, "#d7191c"], [0.5, "#f7f7f7"], [1, "#2c7bb6"]]}, "legend": {"enabled": True, "title": {"text": "{{measure.label}}"}},
        "tw": {"centerZero": True}, "series": [{"type": "heatmap", "name": "{{measure.label}}", "borderWidth": 1, "borderColor": "#ffffff"}],
    }, [CATEGORY, role("row", "Rows", "dimension"), MEASURE]),
    ("time-heatmap", "Time Heatmap", "bar", "Dates grouped by year, month, day or hour against a category, each cell coloured by a measure.", {
        "chart": {**BASE, "type": "heatmap"},
        "xAxis": {"categories": "{{date}}"}, "yAxis": {"categories": "{{row}}", "title": {"text": None}, "reversed": True},
        "colorAxis": {"minColor": "#e8f1fb", "maxColor": "#21409a"}, "legend": {"enabled": True, "title": {"text": "{{measure.label}}"}},
        "tw": {"bucket": "auto"}, "series": [{"type": "heatmap", "name": "{{measure.label}}", "borderWidth": 0}],
    }, [role("date", "Date", "dimension"), role("row", "Rows", "dimension"), MEASURE]),
]

FEATURES = {
    "line-by-group": ["One line per group", "Legend", "Shared category axis"],
    "stacked-column-group": ["Stacked by group", "Stack totals", "Legend"],
    "stacked-area": ["Several measures stacked", "Total and parts", "Legend"],
    "dual-axis": ["Columns and a line", "Second Y axis", "Two measures"],
    "xy-scatter": ["Numeric X and Y", "Colour scale", "Zoom"],
    "xy-bubble": ["Numeric X and Y", "Size by measure", "Colour scale"],
    "xy-line": ["Numeric or date X", "Points in X order", "Zoom"],
    "ohlc": ["Open, high, low, close", "Date axis", "Price ranges"],
    "sunburst-levels": ["Several levels", "Click to drill in", "Sized by measure"],
    "treemap-levels": ["Several levels", "Click to drill in", "Sized by measure"],
    "density": ["Grid of cells over X and Y", "Count or weight", "Colour scale"],
    "map-density": ["Heat layer on a street map", "Latitude / longitude", "Zoom and pan"],
    "sunburst-color": ["Several levels", "Colour scale by a second measure", "Click to drill in"],
    "treemap-color": ["Several levels", "Colour scale by a second measure", "Click to drill in"],
    "sunburst-group": ["One sunburst per group", "Side-by-side comparison", "Up to 9 groups"],
    "category-heatmap": ["Category x category grid", "Colour scale", "Cell per pair"],
    "stacked-bar-group": ["Horizontal stacked bars", "Stack totals", "Legend"],
    "column-two-groups": ["Two or more group levels", "Largest first", "Combined labels"],
    "sorted-bar": ["Largest first", "Optional split-by stacks", "Horizontal"],
    "diverging-bar": ["Positive / negative colours", "Zero line", "Sorted"],
    "dual-axis-columns": ["Two measures", "Second Y axis", "Side-by-side columns"],
    "price-candlestick": ["Open, high, low, close from one price", "Auto time buckets", "Date axis"],
    "order-book": ["Price buckets", "Buy left, sell right", "Count or weight"],
    "xy-scatter-group": ["Colour per group", "Legend", "Optional size"],
    "xy-scatter-labels": ["Labelled points", "Optional colour scale", "Zoom"],
    "treemap-group": ["Split-by as top level", "Colour per group", "Click to drill in"],
    "diverging-heatmap": ["Red-white-blue scale", "Centred on zero", "Category x category"],
    "time-heatmap": ["Auto date buckets", "Date x category grid", "Colour scale"],
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


ALL = [(*chart, ROLES) for chart in CHARTS] + MULTI_CHARTS
rows = [
    UPSERT.format(pid=lit(pid), name=lit(name), desc=lit(desc), ver=lit(VERSION), pub=lit(PUBLISHER),
                  vkey=lit(f"{pid}-mkt"), icon=lit(icon), roles=lit(roles), features=lit(FEATURES[pid]), tpl=lit(template))
    for pid, name, icon, desc, template, roles in ALL
]

out = Path(__file__).with_name("add-marketplace-plugins.sql")
out.write_text(TABLE + "\n".join(rows) + "GO\n", encoding="utf-8")
print(f"{len(ALL)} plugins -> {out}")
