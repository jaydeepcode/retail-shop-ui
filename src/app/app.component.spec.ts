import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppModule } from './app.module';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // The app is NgModule-based: every component is declared in AppModule rather
      // than standalone, so the module is imported instead of the component.
      imports: [AppModule],
      providers: [provideRouter([]), provideHttpClientTesting()]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it(`should have the 'retail-shop-frontend' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.title).toEqual('retail-shop-frontend');
  });

  it('renders the alert host and the outlet every screen is routed into', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-global-alert')).toBeTruthy();
    expect(compiled.querySelector('.container-body-main router-outlet')).toBeTruthy();
  });
});
