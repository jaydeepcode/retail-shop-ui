import { Injectable } from '@angular/core';
import { ActiveTripStatus } from '../model/model';

@Injectable({
    providedIn: 'root'
})
export class TripStateService {
    private activeTrip: ActiveTripStatus = {};

    setActiveTrip(
        tripId: number, 
        customerId: number, 
        pumpUsed: 'inside' | 'outside' | 'both',
        startTime?: Date,
        expectedDurationSeconds?: number
    ) {
        this.activeTrip = {
            tripId,
            customerId,
            startTime: startTime || new Date(),
            pumpUsed,
            expectedDurationSeconds
        };
    }

    getActiveTrip() {
        return this.activeTrip;
    }

    clearActiveTrip() {
        this.activeTrip = {};
    }

    hasActiveTrip(): boolean {
        return !!this.activeTrip.tripId;
    }

    isFillingInProgress(customerId: number): boolean {
        return this.hasActiveTrip() && this.activeTrip.customerId === customerId;
    }

    getActiveTripStartTime(): Date | undefined {
        return this.activeTrip.startTime;
    }
}
