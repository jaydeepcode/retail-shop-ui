import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { BrowserModule, DomSanitizer } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routes';
import { GlobalAlertComponent } from './components/global-alert/global-alert.component';
import { HomeComponent } from './components/home/home.component';
import { PaymentModalComponent } from './components/payment-modal/payment-modal.component';
import { SearchCustomerComponent } from './components/search-customer/search-customer.component';
import { TransactCustomerComponent } from './components/transact-customer/transact-customer.component';
import { WaterPurchaseRegisterComponent } from './components/water-purchase-register/water-purchase-register.component';
import { MatNativeDateModule } from '@angular/material/core';
import { AddTripConfirmationDialogComponent } from './components/add-trip-confirmation-dialog/add-trip-confirmation-dialog.component';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';

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
    MatTableModule
  ],
  declarations: [
    AppComponent,
    SearchCustomerComponent,
    HomeComponent,
    TransactCustomerComponent,
    GlobalAlertComponent,
    PaymentModalComponent,
    WaterPurchaseRegisterComponent,
    AddTripConfirmationDialogComponent
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {
  constructor(iconRegistry: MatIconRegistry, sanitizer: DomSanitizer) {
    iconRegistry.addSvgIcon('register_customer', sanitizer.bypassSecurityTrustResourceUrl('assets/icons/register_customer.svg'));
  }
}
