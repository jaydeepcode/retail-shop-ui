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

    if (this.loginForm.get('signup')?.value) {
      this.authService.signup(this.loginForm.value).subscribe(
        (response) => {
          this.router.navigate(['home']);
          this.alertService.triggerAlert(AlertType.Success, "User registered successfully !")
        },
        (error) => {
          console.error('Signup failed', error);
          this.error = 'Signup failed';
        }
      );
    } else {
      this.authService.login(this.loginForm.value).subscribe(
        (response) => {
          localStorage.setItem('token', response.jwt);
          this.router.navigate(['home']);
        },
        (error) => {
          console.error('Login failed', error);
          this.error = 'Invalid Username or Password';
        }
      );
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

