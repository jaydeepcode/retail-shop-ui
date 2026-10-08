import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { SectionNavComponent } from './section-nav/section-nav.component';
import { SectionPlaceholderComponent } from './section-placeholder/section-placeholder.component';

/** Shared by every lazily loaded section. */
@NgModule({
  imports: [CommonModule, RouterModule],
  declarations: [SectionNavComponent, SectionPlaceholderComponent],
  exports: [CommonModule, RouterModule, SectionNavComponent, SectionPlaceholderComponent]
})
export class SectionChromeModule {}
