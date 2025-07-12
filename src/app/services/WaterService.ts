import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";
import { catchError } from "rxjs/operators";
import { environment } from "../../environments/environment";
import { ActiveTripStatus, CustomerPayment, Page, RcCreditReqDTO, WaterPurchasePartyDTO, WaterPurchaseTransactionDTO } from "../model/model";
import { ApiService } from "./api.service";

@Injectable({
    providedIn: 'root'
})
export class WaterService {
    private apiUrl = environment.apiUrl;

    constructor(private apiService: ApiService) { }

    addWaterTrip(custId: number | undefined, amount: number, pumpUsed: 'inside' | 'outside' | 'both'): Observable<WaterPurchaseTransactionDTO | null> {
        if (custId) {
            const params = {
                customerId: custId,
                tripAmount: amount,
                pumpUsed: pumpUsed
            };
            return this.apiService.postData<WaterPurchaseTransactionDTO>(`/party/record-trip`, null, params);
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

    checkFillingStatus(): Observable<number | null> {
        return this.apiService.getData<number | null>('/party/check-filling-status');
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

    updateWaterTripTime(custId: number | undefined, tripId: number | undefined): Observable<RcCreditReqDTO[] | null> {
        if (custId && tripId) {
            const params = {
                customerId: custId,
                tripId: tripId
            };
            return this.apiService.putData<ActiveTripStatus>(`/party/update-trip-time`, null, params);
        }
        return of(null);
    }

    getInProgressTrip(customerId: number): Observable<ActiveTripStatus | null> {
        return this.apiService.getData<ActiveTripStatus>(`/party/in-progress-trip/${customerId}`).pipe(
            catchError(error => {
                console.error('Error fetching in-progress trip:', error);
                return of(null);
            })
        );
    }
}