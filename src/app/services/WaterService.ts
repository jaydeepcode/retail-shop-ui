import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { Observable, of } from "rxjs";
import { HttpClient, HttpParams } from "@angular/common/http";
import { CustomerPayment, Page, RcCreditReqDTO, WaterPurchasePartyDTO } from "../model/model";

@Injectable({
    providedIn: 'root'
})
export class WaterService {
    private apiUrl = environment.apiUrl;

    constructor(private http: HttpClient) { }

    addWaterTrip(custId: number | undefined, amount: number): Observable<any> {
        if (custId) {
            const params = new HttpParams()
                .set("customerId", custId)
                .set("tripAmount", amount);
            return this.http.post<any>(`${this.apiUrl}/party/record-trip`, null, { params });
        }
        return of(null);
    }

    addWaterPayment(custId: number | undefined, customerPayment: CustomerPayment): Observable<any> {
        if (custId) {
            const params = new HttpParams()
                .set("customerId", custId);

            return this.http.post<any>(`${this.apiUrl}/party/deposit-amount`, customerPayment, { params });
        }
        return of(null);
    }

    registerParty(party: any): Observable<any> {
        return this.http.post(`${this.apiUrl}/party/register`, party);
    }

    checkContact(contactNum: string): Observable<boolean> {
        return this.http.get<boolean>(`${this.apiUrl}/party/check-contact/${contactNum}`);
    }

    getPartyDetails(custId: number): Observable<WaterPurchasePartyDTO> {
        return this.http.get<WaterPurchasePartyDTO>(`${this.apiUrl}/party/details/${custId}`);
    }

    updateParty(custId: string, party: any) {
        return this.http.put<boolean>(`${this.apiUrl}/party/update/${custId}`, party);
    }


    getCalculatedAmount(custId: number | undefined): Observable<number> {
        if (custId) {
            return this.http.get<number>(`${this.apiUrl}/party/trip-amount/${custId}`);
        }
        return of(0);
    }

    getAllTransactions(customerId: number, page: number, size: number): Observable<Page<RcCreditReqDTO>> {
        return this.http.get<Page<RcCreditReqDTO>>(`${this.apiUrl}/party/all-transactions?custId=${customerId}&page=${page}&size=${size}`);
    }
}