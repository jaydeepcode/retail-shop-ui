import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule  } from './app.routes';
import { AppComponent } from './app.component';
import { SearchCustomerComponent } from './components/search-customer/search-customer.component';
import { HomeComponent } from './components/home/home.component';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule, HttpHandler } from '@angular/common/http';
import { TransactCustomerComponent } from './components/transact-customer/transact-customer.component';
import { GlobalAlertComponent } from './components/global-alert/global-alert.component';

@NgModule({
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    RouterModule,
    HttpClientModule,
    ReactiveFormsModule
  ],
  declarations: [
    AppComponent,
    SearchCustomerComponent,
    HomeComponent,
    TransactCustomerComponent,
    GlobalAlertComponent
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
