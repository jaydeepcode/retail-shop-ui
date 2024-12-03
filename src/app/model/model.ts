export interface CustomerProfile {
    custId: number;
    custName: string;
    contactNum: string;
  }
  
export interface WaterPurchaseTransactionDTO {
  waterPurchaseParty:WaterPurchasePartyDTO;
  rcCreditReqList:RcCreditReqDTO[];
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
  credDttm: Date;
  credit: number;
  debit: number;
  balance: number;
}
