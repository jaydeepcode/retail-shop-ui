import { Component, HostListener, Input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SectionTab } from '../section-tab';

/**
 * The dark bar at the top of every section (artboards 1-12).
 *
 * It owns one half of the keyboard map: Alt + a number says *where am I*, and the
 * number is the tab's position in `tabs`. The other half — the function keys that
 * say *what am I doing* (F1/F2, F8, F9, F12) — belongs to the screens themselves,
 * because they act on forms this session does not build.
 */
@Component({
  selector: 'app-section-nav',
  templateUrl: './section-nav.component.html',
  styleUrl: './section-nav.component.scss'
})
export class SectionNavComponent {
  /** The section's own name, at the left of the bar. */
  @Input() sectionName = '';

  /** Tabs in Alt+1..Alt+N order. Left empty by a section with a single screen. */
  @Input() tabs: SectionTab[] = [];

  /** Shown in place of tabs, as the credit book does (artboard 8). */
  @Input() subtitle = '';

  /** The right-hand context line, e.g. 'FY 2026-27 · Tue 7 Oct · jaydeep'. */
  @Input() meta = '';

  constructor(private router: Router, private route: ActivatedRoute) {}

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    // Alt alone. Ctrl+Alt and Cmd+Alt are the browser's and the OS's.
    if (!event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    // event.code rather than event.key, because Alt+1 on macOS reports key '¡'.
    const digit = /^Digit([1-9])$/.exec(event.code);
    if (!digit) {
      return;
    }

    const tab = this.tabs[Number(digit[1]) - 1];
    if (!tab) {
      return;
    }

    event.preventDefault();
    this.router.navigate([tab.link], { relativeTo: this.route });
  }
}
