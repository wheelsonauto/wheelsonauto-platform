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
  applicationId?: string;
  contractId?: string;
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
  source?: string;
  vehicleId?: string;
  recurringPaymentId?: string;
  staffReadAt?: string;
  staffReadBy?: string;
  staffUnread?: boolean;
  aiPlan?: { approvalRequired?: boolean; needsHuman?: boolean };
  starReview?: boolean;
  starReviewReason?: string;
  starReviewAction?: string;
  attachment?: { documentId: string; name: string; contentType: string; size: number; customerUrl?: string; staffUrl?: string };
};

export type MessageFeed = {
  ok: boolean;
  revision: string;
  messages: MessageRecord[];
  starCoach?: StarCoachState;
  error?: string;
};

export type StarCoachInstruction = {
  id: string;
  instruction: string;
  response: string;
  createdAt: string;
  createdBy?: string;
};

export type StarCoachState = {
  autoSendEnabled: boolean;
  instructions: StarCoachInstruction[];
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
  starReviewCount: number;
  latestStarReview?: MessageRecord;
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
  onlineListingId?: string;
  publishedOnline?: boolean;
  onlineAvailability?: string;
  imageUrls?: string[];
  photoArtifacts?: Array<{
    id: string;
    url: string;
    originalName?: string;
    contentType?: string;
    size?: number;
    createdAt?: string;
    createdBy?: string;
    removedAt?: string;
  }>;
  removedAt?: string;
  updatedAt?: string;
};

export type CustomerRecord = {
  id: string;
  customerAccountId?: string;
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
  outstandingBalance?: number;
  contractStartedAt?: string;
  contractEndedAt?: string;
  endDate?: string;
  contractEndReason?: string;
  archivedAt?: string;
  signedAgreementId?: string;
  signedAgreementUrl?: string;
  notes?: string;
  updatedAt?: string;
};

export type PaymentRecord = {
  id: string;
  organizationId?: string;
  customer?: string;
  customerId?: string;
  customerAccountId?: string;
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
  chargePurpose?: 'one_time' | 'dues';
  reason?: string;
  createsDue?: boolean;
  balanceEffect?: 'none' | 'credit';
  balanceRemaining?: number;
  balanceStatus?: string;
  dueAppliedAmount?: number;
  dueRemainingAmount?: number;
  updatedAt?: string;
};

export type ClaimRecord = {
  id: string;
  organizationId?: string;
  customer?: string;
  customerId?: string;
  customerAccountId?: string;
  vehicle?: string;
  vehicleId?: string;
  type?: string;
  amount?: number;
  originalAmount?: number;
  amountPaid?: number;
  remainingAmount?: number;
  status?: string;
  provider?: string;
  due?: string;
  deadline?: string;
  incidentDate?: string;
  reference?: string;
  proofFileName?: string;
  proofUrl?: string;
  removedAt?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RecurringPaymentRecord = {
  id: string;
  customerId?: string;
  customerAccountId?: string;
  organizationId?: string;
  customer?: string;
  phone?: string;
  email?: string;
  vehicle?: string;
  vehicleId?: string;
  vin?: string;
  licensePlate?: string;
  plate?: string;
  tempTag?: string;
  tracker?: string;
  amount?: number;
  outstandingBalance?: number;
  frequency?: string;
  nextRun?: string;
  chargeTime?: string;
  status?: string;
  provider?: string;
  paymentProvider?: string;
  paymentSetup?: string;
  cardLabel?: string;
  cardLast4?: string;
  autoChargeEnabled?: boolean;
  autopayManagedBy?: string;
  autopayEligible?: boolean;
  autopayComplete?: boolean;
  autopayBlockedReason?: string;
  autopayNextAttemptAt?: string;
  cardSetupUrl?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardPaymentItem = {
  id: string;
  customer: string;
  vehicle?: string;
  vehicleId?: string;
  amount: number;
  nextRun?: string;
  chargeTime?: string;
  status: string;
  retryCount: number;
  paymentProvider?: string;
  daysLate?: number;
  customerNotified?: boolean;
};

export type DashboardServiceItem = {
  id: string;
  customer?: string;
  vehicle: string;
  vehicleId?: string;
  issue: string;
  due?: string;
  status: string;
  daysLate?: number;
};

export type DashboardDueItem = {
  id: string;
  customer: string;
  vehicle?: string;
  vehicleId?: string;
  amount: number;
  due: string;
  daysLate: number;
  status: string;
  kind: string;
};

export type DashboardAppointmentItem = {
  id: string;
  customer: string;
  vehicle: string;
  vehicleId?: string;
  date: string;
  time?: string;
  status: string;
  address?: string;
  method?: string;
};

export type DashboardTransactionItem = {
  id: string;
  customer: string;
  vehicle?: string;
  vehicleId?: string;
  amount: number;
  status: string;
  method?: string;
  date?: string;
  reason?: string;
};

export type DashboardCompletedItem = {
  id: string;
  title: string;
  detail?: string;
  status: string;
  vehicleId?: string;
};

export type DashboardPriorityFeed = {
  ok: boolean;
  today: string;
  summary: { collectedAmount: number; collectedCount: number; dueCount: number; priorDueCount: number; failedOnceCount: number; failedTwiceCount: number; serviceNeededCount: number; overdueDuesCount: number; inspectionDueCount: number; lateInspectionCount: number; pickupsTodayCount: number; returnsTodayCount: number };
  todayDue: DashboardPaymentItem[];
  priorDue: DashboardPaymentItem[];
  failedOnce: DashboardPaymentItem[];
  failedTwice: DashboardPaymentItem[];
  towCandidates: DashboardPaymentItem[];
  overdueDues: DashboardDueItem[];
  serviceNeeded: DashboardServiceItem[];
  inspections: DashboardServiceItem[];
  pickups: DashboardAppointmentItem[];
  returns: DashboardAppointmentItem[];
  transactionsToday: DashboardTransactionItem[];
  completedToday: DashboardCompletedItem[];
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
  pickedUp?: boolean;
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
  at?: string;
  date?: string;
  createdAt?: string;
  view?: string;
  tab?: string;
  url?: string;
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
  fixedAt?: string;
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

export type StaffAccountRecord = {
  id: string;
  name?: string;
  username?: string;
  role?: string;
  organizationId?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  status?: string;
  notes?: string;
  loginReady?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CustomerAccountRecord = {
  id: string;
  customerId?: string;
  customer?: string;
  name?: string;
  username?: string;
  organizationId?: string;
  phone?: string;
  email?: string;
  status?: string;
  portalStage?: string;
  loginReady?: boolean;
  vehicleId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type OrganizationRecord = {
  id: string;
  name?: string;
  legalBusinessName?: string;
  type?: string;
  status?: string;
  primaryAdmin?: string;
  businessPhone?: string;
  businessEmail?: string;
  serviceStreet?: string;
  serviceCity?: string;
  serviceState?: string;
  servicePostalCode?: string;
  plan?: string;
  dataScope?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AccountDirectory = {
  ok: boolean;
  staffAccounts: StaffAccountRecord[];
  customerAccounts: CustomerAccountRecord[];
  organizations: OrganizationRecord[];
  customers: CustomerRecord[];
  customerLoginUrl: string;
};

declare global {
  interface Window {
    __WOA_STAFF_USER__?: StaffUser;
    __WOA_RELEASE__?: string;
  }
}
