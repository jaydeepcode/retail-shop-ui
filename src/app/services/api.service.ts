import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";
import { AuthService } from "./auth.service";

@Injectable({ providedIn: 'root' })
export class ApiService {
    constructor(private http: HttpClient, private authService: AuthService) { }

    getData<T>(endpoint:string, params?: { [key: string]: any }): Observable<T> {
        let httpParams = new HttpParams();
        if (params) {
            Object.keys(params).forEach(key => { httpParams = httpParams.append(key, params[key]); });
        }
        return this.http.get<T>(endpoint, { params: httpParams, headers: { Authorization: `Bearer ${this.authService.getToken()}` } });;
    }

    postData<T>(endpoint:string, body: any, params?: { [key: string]: any }): Observable<any> {
        let httpParams = new HttpParams();
        if (params) {
            Object.keys(params).forEach(key => { httpParams = httpParams.append(key, params[key]); });
        }
        return this.http.post<T>(endpoint, body, { params: httpParams, headers: { Authorization: `Bearer ${this.authService.getToken()}` } });
    }

    putData<T>(endpoint:string, body: any, params?: { [key: string]: any }): Observable<any> {
        let httpParams = new HttpParams();
        if (params) {
            Object.keys(params).forEach(key => { httpParams = httpParams.append(key, params[key]); });
        }
        return this.http.put<T>(endpoint, body, { params: httpParams, headers: { Authorization: `Bearer ${this.authService.getToken()}` } });
    }
}