import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { CustomerProfile } from '../../model/model';
import { CustomerService } from '../../services/CustomerService';
import { FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { WaterPurchaseRegisterComponent } from '../water-purchase-register/water-purchase-register.component';

@Component({
  selector: 'app-search-customer',
  templateUrl: './search-customer.component.html',
  styleUrl: './search-customer.component.scss'
})
export class SearchCustomerComponent implements OnInit {
  @Output() selectedCustomer = new EventEmitter<CustomerProfile>();
  searchTerm: FormControl = new FormControl('');
  customers: CustomerProfile[] = [];
  filteredCustomers: CustomerProfile[] = [];
  frequentCustomers: CustomerProfile[] = []; // Populate this with frequent customer data
  displayedColumns: string[] = ['customerName', 'contactNum'];

  constructor(private customerService: CustomerService,
    private router: Router,
    private dialog: MatDialog,
  ) { }

  ngOnInit(): void {
    this.searchTerm.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe((text: string) => {
      if (text.length <= 3) {
        this.filteredCustomers = [];
      } else {
        this.customerService.searchCustomers(text).subscribe((data: CustomerProfile[]) => {
          this.filteredCustomers = (data && data.length > 0) ? data : [];
        })
      }
    })
  }

  onRowClick(profile: CustomerProfile) {
    this.router.navigate([`/transact-customer/${profile.custId}`]);
  }

  openRegistrationForm(): void { this.dialog.open(WaterPurchaseRegisterComponent, { width: '80vw' }); }
}