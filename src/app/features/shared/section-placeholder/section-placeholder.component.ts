import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** What a section's route declares about the screen that will land there. */
export interface PlaceholderCopy {
  title: string;
  /** One line on what the screen is for, from the artboard behind it. */
  note: string;
  /** The furniture that goes in this frame, built in a later slice. */
  slated: string[];
  /** An optional way through to a screen that has no real rows to link from yet. */
  preview?: { label: string; to: (string | number)[] };
}

/**
 * The frame, with the furniture named rather than built. Every recharge, credit,
 * ticket and accounts route points here until its own screen exists: the counter's
 * number entry, the basket and the payment panel all need endpoints that are not
 * designed yet, so nothing here calls or mocks one.
 */
@Component({
  selector: 'app-section-placeholder',
  templateUrl: './section-placeholder.component.html',
  styleUrl: './section-placeholder.component.scss'
})
export class SectionPlaceholderComponent implements OnInit {
  copy!: PlaceholderCopy;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.data.subscribe((data) => {
      this.copy = data['copy'] as PlaceholderCopy;
    });
  }
}
