import { RouterModule, Routes } from '@angular/router';
import { SearchCustomerComponent } from './components/search-customer/search-customer.component';
import { NgModule } from '@angular/core';
import { HomeComponent } from './components/home/home.component';
import { TransactCustomerComponent } from './components/transact-customer/transact-customer.component';
import { CustomerResolver } from './resolvers/CustomerResolver';

export const routes: Routes = [
    {path: '' , redirectTo : 'home', pathMatch: 'full'},
    {path: 'home', component: HomeComponent},
    {path: 'transact-customer/:id' , component: TransactCustomerComponent, resolve : {customerData : CustomerResolver}},
    {path: 'search-customer' , component: SearchCustomerComponent}
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports : [RouterModule]
})
export class AppRoutingModule {}