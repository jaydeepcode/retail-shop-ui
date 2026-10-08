import { CommonModule } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, RouterModule } from '@angular/router';

import { AutoLogoutService } from '../../services/AutoLogoutService';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [HomeComponent],
      imports: [CommonModule, RouterModule],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        // The dashboard only injects this to start it; the real one throws on teardown
        // (AutoLogoutService.ts:61 unsubscribes a timer that resetTimer never created).
        { provide: AutoLogoutService, useValue: {} as AutoLogoutService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function tiles(): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('a.tile'));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('gives every business its own tile, in artboard 0 order', () => {
    const names = tiles().map((tile) => tile.querySelector('.tile-name')?.textContent?.trim());
    expect(names).toEqual(['Water', 'Recharge', 'Credit book', 'Ticket booking', 'Day’s end & accounts']);
  });

  it('sends recharge straight to the counter, not through a customer search', () => {
    const hrefs = tiles().map((tile) => tile.getAttribute('href'));
    expect(hrefs).toEqual(['/search-customer', '/recharge', '/credit', '/tickets', '/accounts']);
  });

  // The three defects the session set out to fix.
  it('makes each tile a real link, so Tab reaches it', () => {
    expect(tiles().length).toBe(5);
    tiles().forEach((tile) => {
      expect(tile.tagName).toBe('A');
      expect(tile.getAttribute('href')).toBeTruthy();
      // The old markup put routerLink on the <img>, which Tab skips entirely.
      expect(tile.querySelector('img[href]')).toBeNull();
    });
  });

  it('shows every caption without hovering', () => {
    tiles().forEach((tile) => {
      const caption = tile.querySelector('.tile-what') as HTMLElement;
      expect(caption.textContent?.trim()).toBeTruthy();
      expect(getComputedStyle(caption).opacity).toBe('1');
    });
  });

  it('no longer names the shared grid after water', () => {
    expect(fixture.nativeElement.querySelector('.bus-type-water')).toBeNull();
    expect(fixture.nativeElement.querySelector('.bus-type-grid')).toBeTruthy();
  });

  it('holds Crockery open without pretending it goes anywhere', () => {
    const deferred = fixture.nativeElement.querySelector('.tile-deferred');
    expect(deferred.tagName).not.toBe('A');
    expect(deferred.textContent).toContain('Crockery');
  });
});
