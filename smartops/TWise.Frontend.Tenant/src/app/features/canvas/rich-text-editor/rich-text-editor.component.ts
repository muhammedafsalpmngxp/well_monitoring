import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild } from '@angular/core';
import { isSafeLink, sanitizeRichText } from '../canvas-style.util';

type Command = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList'
  | 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'removeFormat';

/**
 * The text object's editor, as Power BI's text box: bold, italic, underline, strike, lists, alignment, size, colour,
 * highlight and links. What it writes goes through sanitizeRichText before it is kept, and again when it is read.
 */
@Component({
  selector: 'app-rich-text-editor',
  standalone: false,
  templateUrl: './rich-text-editor.component.html',
  styleUrls: ['./rich-text-editor.component.scss'],
})
export class RichTextEditorComponent implements OnChanges, AfterViewInit {
  @Input() html = '';
  /** The large editor of the text dialog: a taller writing area. */
  @Input() large = false;
  @Output() htmlChange = new EventEmitter<string>();
  @ViewChild('area') area?: ElementRef<HTMLDivElement>;

  readonly sizes = [
    { value: '2', label: 'Small' }, { value: '3', label: 'Normal' }, { value: '4', label: 'Large' }, { value: '5', label: 'Larger' },
    { value: '6', label: 'Heading' }, { value: '7', label: 'Display' },
  ];
  linkProblem = '';
  /** What the editor last wrote, so the host sending it back does not reset the cursor. */
  private written = '';

  ngOnChanges(): void {
    if (this.area && this.html !== this.written) this.area.nativeElement.innerHTML = sanitizeRichText(this.html ?? '');
  }

  ngAfterViewInit(): void {
    if (this.area) this.area.nativeElement.innerHTML = sanitizeRichText(this.html ?? '');
  }

  run(command: Command): void {
    this.area?.nativeElement.focus();
    // ponytail: execCommand is deprecated but is still the one built-in rich text editing every browser has;
    // a selection-based editor replaces it if a browser drops it.
    document.execCommand(command, false);
    this.changed();
  }

  setSize(size: string): void {
    if (!size) return;
    this.area?.nativeElement.focus();
    document.execCommand('fontSize', false, size);
    this.changed();
  }

  setColor(color: string, highlight = false): void {
    this.area?.nativeElement.focus();
    document.execCommand(highlight ? 'hiliteColor' : 'foreColor', false, color);
    this.changed();
  }

  addLink(address: string): void {
    const url = address.trim();
    this.linkProblem = '';
    if (!isSafeLink(url)) {
      this.linkProblem = 'Use an https address, a mailto: address, or a path on this site.';
      return;
    }
    this.area?.nativeElement.focus();
    document.execCommand('createLink', false, url);
    this.changed();
  }

  changed(): void {
    const html = sanitizeRichText(this.area?.nativeElement.innerHTML ?? '');
    this.written = html;
    this.htmlChange.emit(html);
  }

  /** Pasted text comes in plain, so no styles or scripts from elsewhere arrive with it. */
  paste(event: ClipboardEvent): void {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
    this.changed();
  }
}
