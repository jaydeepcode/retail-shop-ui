import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, Observable, switchMap, throwError } from "rxjs";
import { AuthService } from "../services/auth.service";

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
    constructor(private authService: AuthService, private router: Router) { }

    intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        // Skip processing for the refresh-token endpoint
        if (req.url.includes('/api/refresh-token')) {
            return next.handle(req);
        }
        
        const accessToken = localStorage.getItem('accessToken');

        if (accessToken) {
            req = req.clone({
                setHeaders: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
        }

        return next.handle(req).pipe(
            catchError((error) => {
                if (error.status === 401 || error.status === 0 || error.status === 403) {
                    // Token expired, try to refresh it
                    return this.authService.refreshToken().pipe(
                        switchMap((response) => {
                            localStorage.setItem('accessToken', response.accessToken);
                            localStorage.setItem('refreshToken', response.refreshToken);
                            const newReq = req.clone({
                                setHeaders: {
                                    Authorization: `Bearer ${response.accessToken}`,
                                },
                            });
                            return next.handle(newReq);
                        }),
                        catchError((refreshError) => {
                            // Refresh token failed, log the user out
                            this.authService.logout();
                            this.router.navigate(['/login']);
                            return throwError(refreshError);
                        })
                    );
                }
                return throwError(error);
            })
        );
    }
}