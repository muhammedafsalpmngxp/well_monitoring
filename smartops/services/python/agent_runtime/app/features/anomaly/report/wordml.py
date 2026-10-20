"""A small WordprocessingML (.docx) writer: headings, justified paragraphs with bold / italic / coloured runs,
bulleted lists, two-column tables, page-break-before headings and a footer repeated on every page.

Written with zipfile and escaped XML instead of python-docx so the report needs no compiled XML library (python-docx
depends on lxml, which some locked-down hosts refuse to load). Everything the Word report uses is here and nothing
else; the output is a standard package that Word, LibreOffice and python-docx open.
"""
from __future__ import annotations

import datetime as dt
import io
import re
import zipfile
from dataclasses import dataclass
from xml.sax.saxutils import escape

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
# Characters XML 1.0 cannot carry at all (a database value may hold them).
_INVALID_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")


def _text(value: str) -> str:
    return escape(_INVALID_XML.sub("", str(value)).replace("\r\n", " ").replace("\n", " ").replace("\r", " "))


@dataclass
class Run:
    text: str
    bold: bool = False
    italic: bool = False
    size_pt: float | None = None
    color: str | None = None

    def xml(self) -> str:
        props = ""
        if self.bold:
            props += "<w:b/>"
        if self.italic:
            props += "<w:i/>"
        if self.color:
            props += f'<w:color w:val="{escape(self.color)}"/>'
        if self.size_pt:
            props += f'<w:sz w:val="{int(round(self.size_pt * 2))}"/><w:szCs w:val="{int(round(self.size_pt * 2))}"/>'
        rpr = f"<w:rPr>{props}</w:rPr>" if props else ""
        return f'<w:r>{rpr}<w:t xml:space="preserve">{_text(self.text)}</w:t></w:r>'


def _paragraph(runs: list[Run], style: str | None = None, align: str | None = None,
               page_break_before: bool = False) -> str:
    ppr = ""
    if style:
        ppr += f'<w:pStyle w:val="{style}"/>'
    if page_break_before:
        ppr += "<w:pageBreakBefore/>"
    if align:
        ppr += f'<w:jc w:val="{align}"/>'
    ppr = f"<w:pPr>{ppr}</w:pPr>" if ppr else ""
    return f"<w:p>{ppr}{''.join(r.xml() for r in runs)}</w:p>"


class Document:
    """Body elements in order; ``save`` returns the package bytes."""

    # Letter, portrait; margins in twentieths of a point (0.9 in sides, 0.8 in top/bottom).
    PAGE_W, PAGE_H = 12240, 15840
    MARGIN_SIDE, MARGIN_TB = 1296, 1152

    def __init__(self) -> None:
        self._body: list[str] = []
        self._last_is_table = False

    def _add(self, xml: str, table: bool = False) -> None:
        self._body.append(xml)
        self._last_is_table = table

    def heading(self, text: str, level: int, page_break_before: bool = False) -> None:
        style = "Title" if level == 0 else f"Heading{min(max(level, 1), 3)}"
        self._add(_paragraph([Run(text)], style=style, align="left", page_break_before=page_break_before))

    def paragraph(self, runs: list[Run] | str, style: str | None = None, align: str | None = None) -> None:
        runs = [Run(runs)] if isinstance(runs, str) else runs
        align = align or ("left" if style == "IntenseQuote" else "both")
        self._add(_paragraph(runs, style=style, align=align))

    def bullet(self, runs: list[Run] | str) -> None:
        self.paragraph(runs, style="ListBullet")

    def small(self, text: str, italic: bool = True) -> None:
        self.paragraph([Run(text, italic=italic, size_pt=8)])

    def kv_table(self, pairs: list[tuple[str, str]]) -> None:
        if not pairs:
            return
        widths = (3600, 6048)
        rows = []
        for key, value in pairs:
            cells = []
            for i, run in enumerate((Run(str(key), bold=True), Run(str(value)))):
                cells.append(f'<w:tc><w:tcPr><w:tcW w:w="{widths[i]}" w:type="dxa"/></w:tcPr>'
                             f"{_paragraph([run], align='left')}</w:tc>")
            rows.append(f"<w:tr>{''.join(cells)}</w:tr>")
        grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
        self._add('<w:tbl><w:tblPr><w:tblStyle w:val="FindingsTable"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
                  f"<w:tblGrid>{grid}</w:tblGrid>{''.join(rows)}</w:tbl>", table=True)

    # ── the package ──

    def _document_xml(self) -> str:
        body = list(self._body)
        if not body or self._last_is_table:
            body.append("<w:p/>")          # a body (and a cell) must end with a paragraph
        sect = (f'<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/>'
                f'<w:pgSz w:w="{self.PAGE_W}" w:h="{self.PAGE_H}"/>'
                f'<w:pgMar w:top="{self.MARGIN_TB}" w:right="{self.MARGIN_SIDE}" w:bottom="{self.MARGIN_TB}" '
                f'w:left="{self.MARGIN_SIDE}" w:header="720" w:footer="576" w:gutter="0"/></w:sectPr>')
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                f'<w:document xmlns:w="{_W}" xmlns:r="{_R}"><w:body>{"".join(body)}{sect}</w:body></w:document>')

    @staticmethod
    def _footer_xml(text: str) -> str:
        para = _paragraph([Run(text, italic=True, size_pt=7, color="808080")], style="Footer", align="center")
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                f'<w:ftr xmlns:w="{_W}" xmlns:r="{_R}">{para}</w:ftr>')

    @staticmethod
    def _styles_xml() -> str:
        def style(sid: str, name: str, ppr: str = "", rpr: str = "", based: str = "Normal", extra: str = "",
                  default: bool = False) -> str:
            base = f'<w:basedOn w:val="{based}"/>' if based else ""
            flag = ' w:default="1"' if default else ""
            return (f'<w:style w:type="paragraph"{flag} w:styleId="{sid}"><w:name w:val="{name}"/>{base}{extra}'
                    + (f"<w:pPr>{ppr}</w:pPr>" if ppr else "") + (f"<w:rPr>{rpr}</w:rPr>" if rpr else "")
                    + "</w:style>")

        styles = [
            style("Normal", "Normal", ppr='<w:spacing w:after="120" w:line="264" w:lineRule="auto"/><w:jc w:val="both"/>',
                  based="", extra="<w:qFormat/>", default=True),
            style("Title", "Title", ppr='<w:spacing w:after="240"/><w:jc w:val="left"/>',
                  rpr='<w:color w:val="17365D"/><w:sz w:val="52"/><w:szCs w:val="52"/>', extra="<w:qFormat/>"),
            style("Heading1", "heading 1", ppr='<w:keepNext/><w:spacing w:before="360" w:after="120"/>'
                  '<w:jc w:val="left"/><w:outlineLvl w:val="0"/>',
                  rpr='<w:b/><w:color w:val="365F91"/><w:sz w:val="32"/><w:szCs w:val="32"/>', extra="<w:qFormat/>"),
            style("Heading2", "heading 2", ppr='<w:keepNext/><w:spacing w:before="240" w:after="80"/>'
                  '<w:jc w:val="left"/><w:outlineLvl w:val="1"/>',
                  rpr='<w:b/><w:color w:val="4F81BD"/><w:sz w:val="26"/><w:szCs w:val="26"/>', extra="<w:qFormat/>"),
            style("Heading3", "heading 3", ppr='<w:keepNext/><w:spacing w:before="200" w:after="60"/>'
                  '<w:jc w:val="left"/><w:outlineLvl w:val="2"/>',
                  rpr='<w:b/><w:color w:val="4F81BD"/>', extra="<w:qFormat/>"),
            style("ListBullet", "List Bullet", ppr='<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
                  '<w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/><w:jc w:val="both"/>'),
            style("IntenseQuote", "Intense Quote", ppr='<w:keepNext/><w:spacing w:before="160" w:after="80"/>'
                  '<w:ind w:left="288"/><w:jc w:val="left"/>', rpr='<w:b/><w:i/><w:color w:val="4F81BD"/>'),
            style("Footer", "footer", ppr='<w:jc w:val="center"/>'),
            ('<w:style w:type="table" w:styleId="FindingsTable"><w:name w:val="Findings Table"/>'
             '<w:tblPr><w:tblBorders>'
             '<w:top w:val="single" w:sz="8" w:space="0" w:color="4F81BD"/>'
             '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="4F81BD"/>'
             '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8CCE4"/>'
             '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>'
             '</w:tblCellMar></w:tblPr></w:style>'),
        ]
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="{_W}">'
                '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" '
                'w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>'
                '<w:pPrDefault/></w:docDefaults>' + "".join(styles) + "</w:styles>")

    @staticmethod
    def _numbering_xml() -> str:
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="{_W}">'
                '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>'
                '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>'
                '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
                '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')

    def save(self, footer_text: str, title: str) -> bytes:
        now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        parts = {
            "[Content_Types].xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.'
                'wordprocessingml.document.main+xml"/>'
                '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.'
                'wordprocessingml.styles+xml"/>'
                '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.'
                'wordprocessingml.numbering+xml"/>'
                '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.'
                'wordprocessingml.settings+xml"/>'
                '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.'
                'wordprocessingml.footer+xml"/>'
                '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.'
                'core-properties+xml"/>'
                '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.'
                'extended-properties+xml"/></Types>'),
            "_rels/.rels": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'officeDocument" Target="word/document.xml"/>'
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/'
                'core-properties" Target="docProps/core.xml"/>'
                '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'extended-properties" Target="docProps/app.xml"/></Relationships>'),
            "word/_rels/document.xml.rels": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/styles" Target="styles.xml"/>'
                '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/numbering" Target="numbering.xml"/>'
                '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/settings" Target="settings.xml"/>'
                '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/footer" Target="footer1.xml"/></Relationships>'),
            "word/document.xml": self._document_xml(),
            "word/styles.xml": self._styles_xml(),
            "word/numbering.xml": self._numbering_xml(),
            "word/settings.xml": (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                                  f'<w:settings xmlns:w="{_W}"><w:defaultTabStop w:val="720"/>'
                                  '<w:compat><w:compatSetting w:name="compatibilityMode" '
                                  'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
                                  '</w:settings>'),
            "word/footer1.xml": self._footer_xml(footer_text),
            "docProps/core.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
                'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
                f'<dc:title>{_text(title)}</dc:title>'
                f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
                f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>'),
            "docProps/app.xml": (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
                '<Application>Agent Runtime</Application></Properties>'),
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as package:
            for name, content in parts.items():          # [Content_Types].xml first, as the format expects
                package.writestr(name, content.encode("utf-8"))
        return buffer.getvalue()
