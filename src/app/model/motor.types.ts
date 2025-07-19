export type PumpStatus = 'ON' | 'OFF';
export type WaterLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PumpStartTimeResponse {
    startTime?: string;
}

export interface PumpStateResponse {
    status: PumpStatus;
}

export interface MotorStatusResponse {
    pump_inside: PumpStateResponse;
    pump_outside: PumpStateResponse;
    water_level: WaterLevel;
    timestamp: number;
}

export interface PumpSelectionResult {
    inside: PumpStatus;
    outside: PumpStatus;
}
