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

    // The sections of the bookkeeping module, lazily loaded. Each one owns its own
    // child routes; nothing below this block may be appended to by hand, because the
    // '**' catch-all is last and Angular matches in order — a route added after it
    // would silently redirect to login and present as a routing bug.
    {path: 'recharge', loadChildren: () => import('./features/recharge/recharge.module').then(m => m.RechargeModule), canActivate: [AuthGuard]},
    {path: 'credit', loadChildren: () => import('./features/credit/credit.module').then(m => m.CreditModule), canActivate: [AuthGuard]},
    {path: 'tickets', loadChildren: () => import('./features/tickets/tickets.module').then(m => m.TicketsModule), canActivate: [AuthGuard]},
    {path: 'accounts', loadChildren: () => import('./features/accounts/accounts.module').then(m => m.AccountsModule), canActivate: [AuthGuard]},

    {path: '' , redirectTo : '/login', pathMatch: 'full'},
    {path: '**' , redirectTo : '/login'}
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports : [RouterModule]
})
export class AppRoutingModule {}