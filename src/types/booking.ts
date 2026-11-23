export interface CategoryConfig {
  id: string;
  name: string;
  sheetName: string;
  colorHex: string;
  isDefault?: boolean;
}

export interface SheetColumnMap {
  tableNumberIdx: number;
  fullNameIdx: number;
  phoneIdx: number;
  transferAmountIdx: number;
  transferDateIdx: number;
  slipUrlIdx: number;
  paidStatusIdx: number;
  checkedInStatusIdx?: number;
  checkedInAtIdx?: number;
  ticketStatusIdx?: number;
  ticketCollectedAtIdx?: number;
  noteIdx?: number;
  slipUrl2Idx?: number;
  headers: string[];
  matchedByHeader: boolean;
}

export interface SeatRecord {
  id: string;
  rowNumber: number;
  categoryId: string;
  categoryName: string;
  sheetName: string;
  tableNumber: string;
  normalizedTableNumber: string;
  compactTableNumber: string;
  fullName: string;
  phone: string;
  transferAmount: number;
  rawTransferAmount: string;
  transferDate: string;
  slipUrl: string;
  slipUrl2?: string;
  rawPaidStatus: string;
  isPaid: boolean;
  isBooked: boolean;
  isCheckedIn?: boolean;
  checkedInAt?: string;
  isTicketCollected?: boolean;
  ticketCollectedAt?: string;
  note?: string;
}

export interface CategorySheetResult {
  categoryId: string;
  categoryName: string;
  sheetName: string;
  foundSheet: boolean;
  columnMap: SheetColumnMap | null;
  records: SeatRecord[];
  error?: string;
}

export interface SpreadsheetFileItem {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
  shared?: boolean;
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
  }>;
}

export type DriveFilterMode = 'sharedWithMe' | 'all';

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl?: string;
  sheets: Array<{
    sheetId: number;
    title: string;
    rowCount?: number;
    columnCount?: number;
  }>;
}

export interface CategorySummaryStats {
  categoryId: string;
  categoryName: string;
  sheetName: string;
  colorHex: string;
  foundSheet: boolean;
  totalSeats: number;
  bookedSeats: number;
  unbookedSeats: number;
  paidSeats: number;
  unpaidSeats: number;
  checkedInSeats: number;
  uncheckedInSeats: number;
  ticketCollectedSeats: number;
  unticketedSeats: number;
  totalTransferAmount: number;
}

export interface OverallDashboardStats {
  totalSeats: number;
  totalVipSeats: number;
  totalStandardSeats: number;
  bookedSeats: number;
  unbookedSeats: number;
  paidSeats: number;
  unpaidSeats: number;
  checkedInSeats: number;
  uncheckedInSeats: number;
  ticketCollectedSeats: number;
  unticketedSeats: number;
  totalTransferAmount: number;
  vipTransferAmount: number;
  standardTransferAmount: number;
  byCategory: CategorySummaryStats[];
}

export type ExpenseCategoryId =
  | 'venue'
  | 'food'
  | 'equipment'
  | 'staff'
  | 'marketing'
  | 'other';

export interface ExpenseRecord {
  id: string;
  title: string;
  category: ExpenseCategoryId;
  categoryLabel: string;
  amount: number;
  expenseDate: string;
  payeeOrNote: string;
  receiptUrl: string;
  createdAt: string;
}

export type ActiveTab = 'lookup' | 'dashboard' | 'seatmap' | 'backoffice';
