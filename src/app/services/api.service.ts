import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";
import { AuthService } from "./auth.service";
import { environment } from "../../environments/environment";

@Injectable({ providedIn: 'root' })
export class ApiService {
    private apiUrl = environment.apiUrl;
    constructor(private http: HttpClient) { }

    getData<T>(endpoint:string, params?: { [key: string]: any }): Observable<T> {
        let httpParams = new HttpParams();
        if (params) {
            Object.keys(params).forEach(key => { httpParams = httpParams.append(key, params[key]); });
        }
        return this.http.get<T>(`${this.apiUrl}${endpoint}`, { params: httpParams} );
    }

    postData<T>(endpoint:string, body: any, params?: { [key: string]: any }): Observable<any> {
        let httpParams = new HttpParams();
        if (params) {
            Object.keys(params).forEach(key => { httpParams = httpParams.append(key, params[key]); });
        }
        return this.http.post<T>(`${this.apiUrl}${endpoint}`, body, { params: httpParams});
    }

    putData<T>(endpoint:string, body: any, params?: { [key: string]: any }): Observable<any> {
        let httpParams = new HttpParams();
        if (params) {
            Object.keys(params).forEach(key => { httpParams = httpParams.append(key, params[key]); });
        }
        return this.http.put<T>(`${this.apiUrl}${endpoint}`, body, { params: httpParams});
    }
}