import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { Observable, of } from "rxjs";
import { HttpClient, HttpParams } from "@angular/common/http";

@Injectable({
    providedIn: 'root'
})
export class WaterService {
    private apirUrl = environment.apiUrl;
    
    constructor(private http: HttpClient) { }

    addWaterTrip(custId : number | undefined) : Observable<any>{  
        if(custId){
            const params = new HttpParams().set("customerId", custId);
            return this.http.post<any>(`${this.apirUrl}/party/record-trip`, null, {params});
        }
        return of(null);
    }

    addWaterPayment(custId : number | undefined, payAmount:number) : Observable<any>{  
        if(custId){
            const params = new HttpParams()
            .set("customerId", custId)
            .set("amount", payAmount);
            
            return this.http.post<any>(`${this.apirUrl}/party/deposit-amount`, null, {params});
        }
        return of(null);
    }
}