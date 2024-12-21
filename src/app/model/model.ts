export interface CustomerProfile {
  custId: number;
  customerName: string;
  contactNum: string;
  pendingTrips: number;
  balanceAmount: number;
}

export interface WaterPurchaseTransactionDTO {
  waterPurchaseParty: WaterPurchasePartyDTO;
  rcCreditReqList: RcCreditReqDTO[];
  customerName: string;
  balanceAmount: number;
}

export interface CustomerPayment {
  paymentAmount: number,
  paymentMethod: string
}

// water-purchase-party.dto.ts
export interface WaterPurchasePartyDTO {
  customerId: number;
  storageType: string;
  capacity: number;
  vehicleNumber: string | null;
  registrationDate: Date;
  address: string | null;
}


export interface RcCreditReqDTO {
  tripDateTime: Date;
  creditAmount: number;
  depositAmount: number;
  balanceAmount: number;
}

export interface Page<T> {
  content: T[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}
