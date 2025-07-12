import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { BrowserModule, DomSanitizer } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routes';
import { AddTripConfirmationDialogComponent } from './components/add-trip-confirmation-dialog/add-trip-confirmation-dialog.component';
import { GlobalAlertComponent } from './components/global-alert/global-alert.component';
import { HomeComponent } from './components/home/home.component';
import { PaymentModalComponent } from './components/payment-modal/payment-modal.component';
import { PumpControlDialogComponent } from './components/pump-control-dialog/pump-control-dialog.component';
import { SearchCustomerComponent } from './components/search-customer/search-customer.component';
import { TransactCustomerComponent } from './components/transact-customer/transact-customer.component';
import { WaterPurchaseRegisterComponent } from './components/water-purchase-register/water-purchase-register.component';
import { AbsoluteValuePipe } from './pipe/AbsoluteValuePipe';
import { DurationPipe } from './pipe/duration.pipe';
import { LoginComponent } from './components/login/login.component';
import { AuthInterceptor } from './interceptor/AuthInterceptor';

@NgModule({
  imports: [
    BrowserModule,
    AppRoutingModule,
    RouterModule,
    HttpClientModule,
    ReactiveFormsModule,
    BrowserAnimationsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatCardModule,
    MatTableModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatPaginatorModule,
    MatTooltipModule
  ],
  declarations: [
    AppComponent,
    LoginComponent,
    SearchCustomerComponent,
    HomeComponent,
    TransactCustomerComponent,
    GlobalAlertComponent,
    PaymentModalComponent,
    WaterPurchaseRegisterComponent,
    AddTripConfirmationDialogComponent,
    PumpControlDialogComponent,
    AbsoluteValuePipe,
    DurationPipe
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {
  constructor(iconRegistry: MatIconRegistry, sanitizer: DomSanitizer) {
    iconRegistry.addSvgIcon('register_customer', sanitizer.bypassSecurityTrustResourceUrl('assets/icons/register_customer.svg'))
    .addSvgIcon('edit_customer', sanitizer.bypassSecurityTrustResourceUrl('assets/icons/edit_customer.svg'))
    .addSvgIcon('more_vert', sanitizer.bypassSecurityTrustResourceUrl('assets/icons/more_vert.svg'));
  }
}
