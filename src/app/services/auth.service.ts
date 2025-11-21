import { HttpClient, HttpEvent, HttpHeaders } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { BehaviorSubject, Observable, tap, throwError } from "rxjs";
import { Router } from "@angular/router";

@Injectable({ providedIn: 'root' })
export class AuthService {
    private loggedIn = new BehaviorSubject<boolean>(true);
    private apiUrl = environment.apiUrl;
    constructor(private http: HttpClient, private router: Router) { }
    login(credentials: { username: string, password: string }): Observable<any> {
        return this.http.post(`${this.apiUrl}/authenticate`, credentials);
    }

    setIsLoggedIn(loggedIn: boolean) {
        this.loggedIn.next(loggedIn);
    }


    get isLoggedIn() {
        return this.loggedIn.asObservable();
    }

    refreshToken(): Observable<{ accessToken: string, refreshToken: string }> {
        const refreshToken = localStorage.getItem('refreshToken');
        return this.http.post<{ accessToken: string, refreshToken: string }>(`${this.apiUrl}/refresh-token`, {} , {
            headers: {'Refresh-Token': refreshToken ? refreshToken : ''}
            })
            .pipe(tap((response) => {
                localStorage.setItem('accessToken', response.accessToken);
                localStorage.setItem('refreshToken', response.refreshToken);
                },
                (error) => {
                    this.logout();
                    return throwError(error); // Propagate the error
                }
            ));
    }

    signup(value: any): Observable<any> {
        return this.http.post(`${this.apiUrl}/signup`, value);
    }


    logout() {
        this.setIsLoggedIn(false);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        this.router.navigate(['login']);
    }

    isAuthenticated() {
        return localStorage.getItem('accessToken') ? true : false;
    }

    getToken() {
        return localStorage.getItem('accessToken');
    }


}