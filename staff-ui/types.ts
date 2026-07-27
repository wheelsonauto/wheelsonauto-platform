export type StaffUser = {
  id?: string;
  name?: string;
  username?: string;
  role?: string;
  companyName?: string;
};

export type MessageRecord = {
  id: string;
  customer?: string;
  customerId?: string;
  customerAccountId?: string;
  phone?: string;
  email?: string;
  direction?: string;
  channel?: string;
  deliveryChannel?: string;
  subject?: string;
  body?: string;
  status?: string;
  tone?: string;
  createdAt?: string;
  date?: string;
  provider?: string;
  vehicleId?: string;
  recurringPaymentId?: string;
  aiPlan?: { approvalRequired?: boolean; needsHuman?: boolean };
};

export type MessageFeed = {
  ok: boolean;
  revision: string;
  messages: MessageRecord[];
  error?: string;
};

export type MessageThread = {
  key: string;
  customer: string;
  phone: string;
  email: string;
  customerAccountId: string;
  messages: MessageRecord[];
  latest: MessageRecord;
  unread: number;
};

export type PagedFeed<T> = {
  ok: boolean;
  records: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNextPage: boolean;
};

export type TaskRecord = {
  id: string;
  organizationId?: string;
  title: string;
  type?: string;
  customer?: string;
  vehicle?: string;
  due?: string;
  status?: string;
  owner?: string;
  notes?: string;
  doneAt?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type VehicleRecord = {
  id: string;
  organizationId?: string;
  name?: string;
  year?: string | number;
  make?: string;
  model?: string;
  vin?: string;
  plate?: string;
  stock?: string;
  tempTag?: string;
  tracker?: string;
  currentCustomer?: string;
  activeRentalFileId?: string;
  status?: string;
  mileage?: string | number;
  color?: string;
  location?: string;
  notes?: string;
  updatedAt?: string;
};

export type CustomerRecord = {
  id: string;
  organizationId?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  vehicleId?: string;
  activeRentalFileId?: string;
  vehicle?: string;
  vin?: string;
  licensePlate?: string;
  status?: string;
  stage?: string;
  nextRun?: string;
  amount?: number;
  notes?: string;
  updatedAt?: string;
};

export type PaymentRecord = {
  id: string;
  organizationId?: string;
  customer?: string;
  customerId?: string;
  vehicle?: string;
  vehicleId?: string;
  rentalFileId?: string;
  vin?: string;
  plate?: string;
  amount?: number;
  status?: string;
  method?: string;
  source?: string;
  date?: string;
  createdAt?: string;
  provider?: string;
  paymentProvider?: string;
  notes?: string;
  updatedAt?: string;
};

export type RentalRecord = {
  id: string;
  customerName?: string;
  customerId?: string;
  vehicleName?: string;
  vehicleId?: string;
  vin?: string;
  plate?: string;
  tracker?: string;
  status?: string;
  weeklyAmount?: number;
  paymentProvider?: string;
  paymentDay?: string;
  nextChargeDate?: string;
  autopayAnchorDate?: string;
  actualPickupDate?: string;
  startDate?: string;
  endDate?: string;
  endReason?: string;
  startingMileage?: number;
  endingMileage?: number;
  customerAccountId?: string;
  applicationId?: string;
  onboardingSessionId?: string;
  pickupAppointmentId?: string;
  recurringPaymentId?: string;
  contractId?: string;
  updatedAt?: string;
};

export type RentalLinkedRecord = {
  id: string;
  customer?: string;
  name?: string;
  title?: string;
  vehicle?: string;
  type?: string;
  status?: string;
  amount?: number;
  balance?: number;
  body?: string;
  subject?: string;
  issue?: string;
  notes?: string;
  provider?: string;
  method?: string;
  source?: string;
  channel?: string;
  frequency?: string;
  nextRun?: string;
  originalName?: string;
  contentType?: string;
  transactionDate?: string;
  postingDate?: string;
  due?: string;
  nextDue?: string;
  date?: string;
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string;
  signedAt?: string;
  completedAt?: string;
  direction?: string;
};

export type RentalDetail = {
  ok: boolean;
  rentalFile: RentalRecord;
  records: Record<string, RentalLinkedRecord[]>;
};

export type ApplicationItem = {
  id: string;
  name: string;
  vehicle?: string;
  status?: string;
  paid?: boolean;
  scheduledPickup?: boolean;
  pickupDate?: string;
  pickupTime?: string;
  lastActivityAt?: string;
  rentalFileId?: string;
};

export type ApplicationFeed = {
  ok: boolean;
  revision: string;
  items: ApplicationItem[];
  counts: { review: number; scheduledPickup: number; history: number };
};

export type ProviderRecord = {
  id: string;
  name?: string;
  group?: string;
  status?: string;
  owner?: string;
  endpoint?: string;
  liveTest?: string;
  lastTestAt?: string;
  lastTestResult?: string;
  notes?: string;
};

export type NotificationRecord = {
  id: string;
  title?: string;
  body?: string;
  message?: string;
  type?: string;
  tone?: string;
  date?: string;
  createdAt?: string;
  read?: boolean;
};

export type NotificationFeed = {
  ok: boolean;
  notifications?: NotificationRecord[];
  notices?: NotificationRecord[];
  items?: NotificationRecord[];
  unread?: number;
  unreadCount?: number;
};

export type MaintenanceRecord = {
  id: string;
  organizationId?: string;
  vehicleId: string;
  vehicle?: string;
  customer?: string;
  vin?: string;
  licensePlate?: string;
  plate?: string;
  tracker?: string;
  type?: string;
  issue?: string;
  cost?: number;
  due?: string;
  nextDue?: string;
  reminder?: string;
  notes?: string;
  status?: string;
  completedAt?: string;
  odometer?: string | number;
  mileageAtService?: string | number;
  inspectionCondition?: string;
  inspectionChecklist?: string[];
  damageNotes?: string;
  mechanicSignoff?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

declare global {
  interface Window {
    __WOA_STAFF_USER__?: StaffUser;
    __WOA_RELEASE__?: string;
  }
}
