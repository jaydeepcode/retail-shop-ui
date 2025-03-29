import { Component, OnInit } from '@angular/core';
import { UserDetailService } from '../../services/UserDetailService';
import { AuthService } from '../../services/auth.service';
import { AutoLogoutService } from '../../services/AutoLogoutService';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  userDetails: any;
  constructor(private userDetailService: UserDetailService,
    private authService: AuthService,private autoLogoutService: AutoLogoutService
  ) {
  }
  
  ngOnInit(): void {
    this.userDetailService.userDetail$.subscribe((user) => {
      this.userDetails = user;
    });

    this.userDetailService.loadUserDetail();
  }

  logout() {
    this.userDetailService.setUserDetail(null);
    this.authService.logout();
  }


}
