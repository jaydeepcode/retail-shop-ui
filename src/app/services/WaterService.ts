import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";
import { environment } from "../../environments/environment";
import { CustomerPayment, Page, RcCreditReqDTO, WaterPurchasePartyDTO } from "../model/model";
import { ApiService } from "./api.service";

@Injectable({
    providedIn: 'root'
})
export class WaterService {
    private apiUrl = environment.apiUrl;

    constructor(private apiService: ApiService) { }

    addWaterTrip(custId: number | undefined, amount: number): Observable<any> {
        if (custId) {
            const params = { customerId: custId, tripAmount: amount };
            return this.apiService.postData<any>(`/party/record-trip`, null, params);
        }
        return of(null);
    }

    addWaterPayment(custId: number | undefined, customerPayment: CustomerPayment): Observable<any> {
        if (custId) {
            const params = { customerId: custId };
            return this.apiService.postData<any>(`/party/deposit-amount`, customerPayment, params);
        }
        return of(null);
    }

    registerParty(party: any): Observable<any> {
        return this.apiService.postData(`/party/register`, party);
    }

    checkContact(contactNum: string): Observable<boolean> {
        return this.apiService.getData<boolean>(`/party/check-contact/${contactNum}`);
    }

    getPartyDetails(custId: number): Observable<WaterPurchasePartyDTO> {
        return this.apiService.getData<WaterPurchasePartyDTO>(`/party/details/${custId}`);
    }

    updateParty(custId: string, party: any) {
        return this.apiService.putData<boolean>(`/party/update/${custId}`, party);
    }


    getCalculatedAmount(custId: number | undefined): Observable<number> {
        if (custId) {
            return this.apiService.getData<number>(`/party/trip-amount/${custId}`);
        }
        return of(0);
    }

    getAllTransactions(customerId: number, page: number, size: number): Observable<Page<RcCreditReqDTO>> {
        return this.apiService.getData<Page<RcCreditReqDTO>>(`/party/all-transactions?custId=${customerId}&page=${page}&size=${size}`);
    }
}