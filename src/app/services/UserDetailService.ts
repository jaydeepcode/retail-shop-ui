import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";
import { ApiService } from "./api.service";

@Injectable(
    { providedIn: 'root' }
)
export class UserDetailService {
    private userDetail = new BehaviorSubject<any>(null);
    userDetail$ = this.userDetail.asObservable();

    constructor(private apiService: ApiService) { }

    setUserDetail(user: any) {
        this.userDetail.next(user);
    }

    loadUserDetail() {
        this.apiService.getData<any>('/api/user/details').subscribe({
            next: (response) => {
                this.setUserDetail(response);
            },
            error: (error) => {
                console.error('Failed to fetch user details', error);
            }
        });
    }
}