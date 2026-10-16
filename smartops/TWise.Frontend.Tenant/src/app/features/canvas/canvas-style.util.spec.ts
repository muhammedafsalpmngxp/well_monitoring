import { describe, expect, it } from 'vitest';
import type Highcharts from 'highcharts';
import {
  THEMES, fitFontSize, frameCss, readBrandKit, readPageSize, isImageSource, pageCss, paletteFor, readItemStyle, readPageStyle, richTextPlain, sanitizeRichText, styleChart, titleCss, withOpacity,
} from './canvas-style.util';

describe('readItemStyle and readPageStyle', () => {
  it('keeps settings of the right shape and drops the rest', () => {
    expect(readItemStyle({ showTitle: false, titleSize: 18, titleColor: '#123abc', radius: 99, background: 'red', legendPosition: 'left', x: 1 }))
      .toEqual({ showTitle: false, titleSize: 18, titleColor: '#123abc', legendPosition: 'left' });
    expect(readItemStyle({ palette: ['#fff', 'nope'] })).toBeUndefined();
    expect(readItemStyle('bold')).toBeUndefined();
    expect(readPageStyle({ theme: 'ocean', spacing: 8, backgroundImage: 'javascript:alert(1)' })).toEqual({ theme: 'ocean', spacing: 8 });
  });

  it('sanitizes rich text again as it is read', () => {
    expect(readItemStyle({ html: '<b>Hi</b><script>alert(1)</script>' })).toEqual({ html: '<b>Hi</b>' });
  });
});

describe('sanitizeRichText', () => {
  it('keeps simple formatting, safe links and checked styles, and drops everything else', () => {
    expect(sanitizeRichText('<p style="text-align: center; position: fixed">A <b onclick="x()">bold</b> <img src=x onerror=alert(1)>word</p>'))
      .toBe('<p style="text-align: center">A <b>bold</b> word</p>');
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a> <a href="https://tasnim.example">y</a>'))
      .toBe('<a target="_blank" rel="noopener noreferrer">x</a> <a href="https://tasnim.example" target="_blank" rel="noopener noreferrer">y</a>');
    expect(sanitizeRichText('<font color="#ff0000" face="x">red</font><style>body{}</style>')).toBe('<font color="#ff0000">red</font>');
    expect(richTextPlain('<p>Hello <b>there</b></p>')).toBe('Hello there');
  });
});

describe('images and links', () => {
  it('takes https, paths on this site and small embedded images, nothing else', () => {
    expect(isImageSource('https://cdn.example/logo.png')).toBe(true);
    expect(isImageSource('/assets/logo.svg')).toBe(true);
    expect(isImageSource('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isImageSource('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isImageSource('http://plain.example/x.png')).toBe(false);
    expect(isImageSource('//other.example/x.png')).toBe(false);
  });
});

describe('css helpers', () => {
  it('writes the frame, the title and the page', () => {
    expect(withOpacity('#abc', 50)).toBe('#aabbcc80');
    expect(frameCss({ background: '#ffffff', backgroundOpacity: 50, border: true, borderColor: '#000000', radius: 12, shadow: false, padding: 6 }))
      .toEqual({
        background: '#ffffff80', 'border-color': '#000000', 'border-width': '1px', 'border-style': 'solid', 'border-radius': '12px',
        'box-shadow': 'none', '--canvas-object-padding': '6px',
      });
    expect(titleCss({ titleSize: 20, titleAlign: 'center', titleBold: true })).toEqual({ 'font-size': '20px', 'text-align': 'center', 'font-weight': '700' });
    expect(pageCss({ wallpaper: '#101820', background: '#ffffff', backgroundImage: '/assets/bg.png', backgroundFit: 'tile' })).toEqual({
      stage: { background: '#101820' },
      sheet: { background: 'url("/assets/bg.png") center / auto repeat, #ffffff' },
    });
  });

  it('takes the object palette, or the sheet theme', () => {
    expect(paletteFor({ palette: ['#111111'] }, 'ocean')).toEqual(['#111111']);
    expect(paletteFor(undefined, 'sunset')).toBe(THEMES.sunset.colors);
  });
});

describe('styleChart', () => {
  it('sets legend text, axis labels and data labels as the Format pane chooses', () => {
    const options: Highcharts.Options = {
      legend: { enabled: true },
      xAxis: { labels: { style: {} } },
      yAxis: { labels: { style: {} } },
      plotOptions: { series: { dataLabels: { enabled: true } }, pie: { dataLabels: { style: { fontWeight: '600' } } } },
    };
    const styled = styleChart(options, {
      legendSize: 14, legendColor: '#112233', xLabels: false, xRotation: -45, yLabels: false, labelPosition: 'inside', labelSize: 12, labelColor: '#ffffff',
    });
    expect(styled.legend).toMatchObject({ itemStyle: { fontSize: '14px', color: '#112233' } });
    expect(styled.xAxis).toMatchObject({ labels: { enabled: false, rotation: -45 } });
    expect(styled.yAxis).toMatchObject({ labels: { enabled: false } });
    expect(styled.plotOptions?.series?.dataLabels).toMatchObject({ enabled: true, inside: true, style: { fontSize: '12px', color: '#ffffff' } });
    expect(styled.plotOptions?.pie?.dataLabels).toMatchObject({ distance: -30, style: { fontWeight: '600', fontSize: '12px' } });
    expect(readItemStyle({ xRotation: 30, labelPosition: 'center', legendSize: 12 })).toEqual({ legendSize: 12 });
  });

  it('lays the legend, axes, range, gridlines and smooth lines over the chart options', () => {
    const options: Highcharts.Options = {
      legend: { enabled: true },
      xAxis: { labels: { style: {} } },
      yAxis: { labels: { style: {} } },
      series: [{ type: 'line', data: [1] }, { type: 'column', data: [2] }],
    };
    const styled = styleChart(options, { legend: false, legendPosition: 'right', xTitle: 'Crew', yMin: 0, yMax: 100, gridlines: false, smooth: true, axisFontSize: 13 });

    expect(styled.legend).toMatchObject({ enabled: false, layout: 'vertical', align: 'right', verticalAlign: 'middle' });
    expect(styled.xAxis).toMatchObject({ title: { text: 'Crew' }, labels: { style: { fontSize: '13px' } } });
    expect(styled.yAxis).toMatchObject({ min: 0, max: 100, gridLineWidth: 0 });
    expect((styled.series ?? []).map(s => (s as { type: string }).type)).toEqual(['spline', 'column']);
    expect(styleChart(options, undefined)).toBe(options);
  });
});

describe('brand kit and page size', () => {
  it('keeps a well-formed brand kit and page size, and puts brand colours after the sheet theme', () => {
    expect(readBrandKit({ colors: ['#112233'], font: 'Georgia', logo: '/assets/logo.png', x: 1 }))
      .toEqual({ colors: ['#112233'], font: 'Georgia', logo: '/assets/logo.png' });
    expect(readBrandKit({ font: 'Comic; background:url(x)', logo: 'javascript:alert(1)' })).toBeNull();
    expect(readPageSize({ preset: '16:9', width: 1280, height: 720 })).toEqual({ preset: '16:9', width: 1280, height: 720 });
    expect(readPageSize({ preset: 'custom', width: 99999, height: 720 })).toBeNull();
    expect(paletteFor(undefined, undefined, ['#010101'])).toEqual(['#010101']);
    expect(paletteFor(undefined, 'ocean', ['#010101'])).toBe(THEMES.ocean.colors);
    expect(paletteFor(undefined, undefined)).toBe(THEMES.tasnim.colors);
  });
});

describe('fitFontSize', () => {
  it('keeps the full size when the text fits, and otherwise finds the largest size that fits', () => {
    expect(fitFontSize(() => true, 14)).toBe(14);
    const tried: number[] = [];
    const size = fitFontSize(s => { tried.push(s); return s <= 9.5; }, 14);
    expect(size).toBe(9.5);
    expect(tried[tried.length - 1]).toBe(9.5);
    expect(fitFontSize(() => false, 14)).toBe(6);
  });
});
