import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { CustomerProfile } from '../../model/model';
import { CustomerService } from '../../services/CustomerService';
import { WaterPurchaseRegisterComponent } from '../water-purchase-register/water-purchase-register.component';

@Component({
  selector: 'app-search-customer',
  templateUrl: './search-customer.component.html',
  styleUrl: './search-customer.component.scss'
})
export class SearchCustomerComponent implements OnInit {
  
  @Output() selectedCustomer = new EventEmitter<CustomerProfile>();
  
  topCustomers: CustomerProfile[] = [];
  searchTerm: FormControl = new FormControl('');
  filteredCustomers: CustomerProfile[] = [];
  displayedColumns: string[] = ['customerName', 'contactNum', 'contactEdit'];
  selectedCustomerCard: CustomerProfile | null = null;;

  constructor(private customerService: CustomerService,
    private router: Router,
    private dialog: MatDialog,
  ) { }

  ngOnInit(): void {
    this.loadTopCustomers();
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

  loadTopCustomers() {
    this.topCustomers = []
    this.customerService.getRecentCustomers().subscribe(topCustomerData => {
      this.topCustomers.push(...topCustomerData); // Assuming the data is paginated and using the content array
    })
  }

  onRowClick(profile: CustomerProfile) {
    this.router.navigate([`/transact-customer/${profile.custId}`]);
  }

  openRegistrationForm(): void { this.dialog.open(WaterPurchaseRegisterComponent, { width: '80vw' }); }

  editCustomer(customer: CustomerProfile) {
    const waterPurchaseRegisterDialog = this.dialog.open(WaterPurchaseRegisterComponent, { width: '80vw', data: customer });
    waterPurchaseRegisterDialog.afterClosed().subscribe(() => {
      this.filteredCustomers = [];
      this.searchTerm.setValue('');
      this.loadTopCustomers();
    })
  }

  editMenuCustomer() {
    if (this.selectedCustomerCard) {
      this.editCustomer(this.selectedCustomerCard);
    }
  }

  setSelectedCustomer(selectedCustomer: CustomerProfile) {
    this.selectedCustomerCard = selectedCustomer;
  }

  deleteCustomer(customer: any) {
    console.log('Deleting customer:', customer);

    // Implement your logic for deleting the customer's details here
  }
}