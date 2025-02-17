import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { Observable } from "rxjs";
import { Router } from "@angular/router";

@Injectable({ providedIn: 'root' })
export class AuthService {

    private apiUrl = environment.apiUrl;
    constructor(private http: HttpClient, private router: Router) { }
    login(credentials: { username: string, password: string }): Observable<any> {
        return this.http.post(`${this.apiUrl}/authenticate`, credentials);
    }

    signup(value: any): Observable<any>  {
        return this.http.post(`${this.apiUrl}/signup`, value);
    }
  

    logout() {
        localStorage.removeItem('token');
        this.router.navigate(['login']);
    }

    isAuthenticated() {
        return localStorage.getItem('token') ? true : false;
    }

    getToken() {
        return localStorage.getItem('token');
    }
}