import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { Observable, of } from "rxjs";
import { HttpClient, HttpParams } from "@angular/common/http";
import { CustomerPayment, WaterPurchasePartyDTO } from "../model/model";

@Injectable({
    providedIn: 'root'
})
export class WaterService {
    private apirUrl = environment.apiUrl;

    constructor(private http: HttpClient) { }

    addWaterTrip(custId: number | undefined, amount: number): Observable<any> {
        if (custId) {
            const params = new HttpParams()
                .set("customerId", custId)
                .set("tripAmount", amount);
            return this.http.post<any>(`${this.apirUrl}/party/record-trip`, null, { params });
        }
        return of(null);
    }

    addWaterPayment(custId: number | undefined, customerPayment: CustomerPayment): Observable<any> {
        if (custId) {
            const params = new HttpParams()
                .set("customerId", custId);

            return this.http.post<any>(`${this.apirUrl}/party/deposit-amount`, customerPayment, { params });
        }
        return of(null);
    }

    registerParty(party: any): Observable<any> {
        return this.http.post(`${this.apirUrl}/party/register`, party);
    }

    checkContact(contactNum: string): Observable<boolean> {
        return this.http.get<boolean>(`${this.apirUrl}/party/check-contact/${contactNum}`);
    }

    getPartyDetails(custId: number): Observable<WaterPurchasePartyDTO> {
        return this.http.get<WaterPurchasePartyDTO>(`${this.apirUrl}/party/details/${custId}`);
    }

    updateParty(custId: string, party: any) {
        return this.http.put<boolean>(`${this.apirUrl}/party/update/${custId}`, party);
    }


    getCalculatedAmount(custId: number | undefined): Observable<number> {
        if (custId) {
            return this.http.get<number>(`${this.apirUrl}/party/trip-amount/${custId}`);
        }
        return of(0);
    }
}