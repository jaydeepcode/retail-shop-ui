import { Component, OnInit } from '@angular/core';

import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AbstractControl, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertService, AlertType } from '../../services/alert.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {

  error: string | null = null;
  loginForm: FormGroup;
  hide = true;
  hideConfirm = true;
  isLoading = false;
  constructor(private authService: AuthService,
    private router: Router,
    private fb: FormBuilder,
    private alertService: AlertService) {

    this.loginForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
      confirmPassword: [''],
      signup: [false],
      firstName: [''],
      lastName: [''],
      role: ['']
    });

    this.updateValidators();
    this.loginForm.get('signup')?.valueChanges.subscribe(() => { 
       this.error = null;
      this.updateValidators(); 
    });

  }

  checkPasswords(control: AbstractControl) { 
    const form = control as FormGroup;
    return form.get('password')?.value === form.get('confirmPassword')?.value ? null : { mismatch: true };
  }

  ngOnInit(): void {
    localStorage.removeItem('token');
  }

  login() {
    if(this.loginForm.invalid) 
      return;

    this.error = null;
    this.isLoading = true;

    if (this.loginForm.get('signup')?.value) {
      // REGISTRATION FLOW
      this.authService.signup(this.loginForm.value).subscribe({
        next: (response) => {
          // Show success message
          this.alertService.triggerAlert(
            AlertType.Success, 
            "Registration successful! Please login with your new credentials"
          );
          
          // Clear form but keep username
          const username = this.loginForm.get('username')?.value;
          this.loginForm.reset();
          this.loginForm.get('username')?.setValue(username);
          
          // Switch back to login mode
          this.loginForm.get('signup')?.setValue(false);
          this.error = null;
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Signup failed', error);
          
          // Backend returns plain text on success, so error handler is called
          // Check if this is actually a success (text response or 200 status)
          if (error.error instanceof ProgressEvent || error.status === 200 || typeof error.error === 'string') {
            // Treat as success
            this.alertService.triggerAlert(
              AlertType.Success,
              "Registration successful! Please login with your new credentials"
            );
            const username = this.loginForm.get('username')?.value;
            this.loginForm.reset();
            this.loginForm.get('username')?.setValue(username);
            this.loginForm.get('signup')?.setValue(false);
            this.error = null;
          } else {
            // Actual error
            this.error = this.extractErrorMessage(error);
          }
          this.isLoading = false;
        }
      });
    } else {
      // LOGIN FLOW
      this.authService.login(this.loginForm.value).subscribe({
        next: (response) => {
          this.authService.setIsLoggedIn(true);
          localStorage.setItem('accessToken', response.accessToken);
          localStorage.setItem('refreshToken', response.refreshToken);
          this.router.navigate(['home']);
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Login failed', error);
          this.error = this.extractErrorMessage(error);
          this.isLoading = false;
        }
      });
    }
  }

  private extractErrorMessage(error: any): string {
    if (error.error?.message) {
      return error.error.message;
    }
    
    switch (error.status) {
      case 400: return 'Invalid data. Please check all required fields.';
      case 401: return 'Invalid username or password.';
      case 403: return 'Account pending approval or disabled.';
      case 409: return 'Username already exists.';
      case 500: return 'Server error. Please try again later.';
      case 0: return 'Cannot connect to server. Please check your connection.';
      default: return `Error: ${error.statusText || 'Unknown error'}`;
    }
  }

  updateValidators() {
    if (this.loginForm.get('signup')?.value) {
      this.loginForm.setValidators([this.checkPasswords]);
      this.loginForm.get('firstName')?.setValidators([Validators.required]);
      this.loginForm.get('lastName')?.setValidators([Validators.required]);
      this.loginForm.get('role')?.setValidators([Validators.required]);
      this.loginForm.get('confirmPassword')?.setValidators([Validators.required]);
    }
    else {
      this.loginForm.clearValidators();
      this.loginForm.get('firstName')?.clearValidators();
      this.loginForm.get('lastName')?.clearValidators();
      this.loginForm.get('role')?.clearValidators();
      this.loginForm.get('confirmPassword')?.clearValidators();
    }
    //this.loginForm.updateValueAndValidity();
    this.loginForm.get('firstName')?.updateValueAndValidity();
    this.loginForm.get('lastName')?.updateValueAndValidity();
    this.loginForm.get('role')?.updateValueAndValidity();
    this.loginForm.get('confirmPassword')?.updateValueAndValidity();
  }
}

