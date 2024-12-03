import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CustomerProfile } from '../../model/model';
import { CustomerService } from '../../services/CustomerService';
import { FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

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

  constructor(private customerService: CustomerService) { }

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
    this.selectedCustomer.emit(profile);
  }
}