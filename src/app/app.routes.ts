import { RouterModule, Routes } from '@angular/router';
import { SearchCustomerComponent } from './components/search-customer/search-customer.component';
import { NgModule } from '@angular/core';
import { HomeComponent } from './components/home/home.component';
import { TransactCustomerComponent } from './components/transact-customer/transact-customer.component';
import { CustomerResolver } from './resolvers/CustomerResolver';
import { LoginComponent } from './components/login/login.component';
import { AuthGuard } from './services/auth.gaurd';

export const routes: Routes = [
    {path: 'login' , component: LoginComponent},
    {path: 'home', component: HomeComponent, canActivate: [AuthGuard]},
    {path: 'transact-customer/:id' , component: TransactCustomerComponent, resolve : {customerData : CustomerResolver}, canActivate: [AuthGuard]},
    {path: 'search-customer' , component: SearchCustomerComponent, canActivate: [AuthGuard]},
    {path: '' , redirectTo : '/login', pathMatch: 'full'},
    {path: '**' , redirectTo : '/login'}
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports : [RouterModule]
})
export class AppRoutingModule {}