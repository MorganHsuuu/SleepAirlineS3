export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: PushSubscriptionKeys;
}

export interface LandingReminderRecord {
  id: string;
  passengerId: string;
  passengerName: string;
  groupId: string;
  flightId: string;
  takeoffTime: string;
  endpoint: string;
  subscription: PushSubscriptionPayload;
  enabled: boolean;
  lastReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscribeLandingReminderInput {
  passengerId: string;
  passengerName: string;
  groupId: string;
  flightId: string;
  takeoffTime: string;
  subscription: PushSubscriptionPayload;
}

export interface ReminderCronResult {
  checked: number;
  due: number;
  sent: number;
  removed: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}
