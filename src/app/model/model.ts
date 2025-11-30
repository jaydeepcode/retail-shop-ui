export interface CustomerProfile {
  custId: number;
  customerName: string;
  contactNum: string;
  pendingTrips: number;
  balanceAmount: number;
}

export interface WaterPurchaseTransactionDTO {
  purchaseId: number;
  waterPurchaseParty: WaterPurchasePartyDTO;
  rcCreditReqList: RcCreditReqDTO[];
  customerName: string;
  balanceAmount: number;
}

export interface ActiveTripStatus {
  tripId?: number;
  customerId?: number;
  startTime?: Date;
  tripStartTime?: Date | string; // Backend sends this as tripStartTime
  pumpUsed?: 'inside' | 'outside' | 'both';
  expectedDurationSeconds?: number;
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
  pumpUsed?: 'inside' | 'outside' | 'both';
  status?: 'FILLING' | 'COMPLETED';
}


export interface RcCreditReqDTO {
  tripDateTime: Date;
  creditAmount: number;
  depositAmount: number;
  balanceAmount: number;
  credBy: string;
  status: 'FILLING' | 'COMPLETED';
  pumpUsed: 'inside' | 'outside' | 'both';
  endTime?: Date;
  startTime?: Date;
}

export interface Page<T> {
  content: T[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}
