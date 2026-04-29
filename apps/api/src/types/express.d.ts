import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    locationId?: string;
    user?: {
      userId: string;
      role: "CUSTOMER" | "STAFF" | "ADMIN";
      employeeRole?: "MANAGER" | "CASHIER" | "KITCHEN" | "DRIVER";
      locationId?: string;
      stationLocationId?: string;
      isPosSession: boolean;
      sessionId: string;
    };
    kdsStationSession?: {
      id: string;
      locationId: string;
      sessionKey: string;
    };
  }
}
