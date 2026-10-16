import { Directive, ElementRef, Input, OnChanges } from '@angular/core';
import { createElement, Palette, Upload, UploadCloud, Trash2, X, ArrowRight, Info, Image } from 'lucide';

const ICONS = { palette: Palette, upload: Upload, cloud: UploadCloud, trash: Trash2, close: X, arrow: ArrowRight, info: Info, image: Image };

@Directive({ selector: '[appLogoIcon]', standalone: true })
export class DashboardBrandingIconDirective implements OnChanges {
  @Input() appLogoIcon: keyof typeof ICONS = 'upload';
  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngOnChanges(): void {
    this.host.nativeElement.replaceChildren(createElement(ICONS[this.appLogoIcon], { width: '18', height: '18', 'aria-hidden': 'true' }));
  }
}