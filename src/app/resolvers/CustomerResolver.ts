import { ActivatedRouteSnapshot, Resolve, RouterStateSnapshot } from "@angular/router";
import { CustomerService } from "../services/CustomerService";
import { Injectable } from "@angular/core";

@Injectable({ providedIn: 'root' })
export class CustomerResolver implements Resolve<any> {

    constructor(private customerService: CustomerService) { }

    resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
        const customerId = Number(route.paramMap.get('id'));
        return this.customerService.getTransactions(customerId)
    }
}