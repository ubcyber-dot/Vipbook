import * as XLSX from 'xlsx';
import {
  CategoryConfig,
  CategorySheetResult,
  ExpenseCategoryId,
  ExpenseRecord,
  SeatRecord,
  SheetColumnMap,
} from '../types/booking';
import {
  BatchReadResponse,
  CloudSystemState,
  TemplateSheetPayload,
} from '../services/sheetsApi';
import { sanitizeSafeUrl } from './media';

export const STANDARD_TEMPLATE_HEADERS = [
  'เลขโต๊ะ',
  'ชื่อ-นามสกุล',
  'เบอร์โทร',
  'ยอดโอน',
  'วันที่โอน',
  'ลิ้งค์สลีป',
  'โอนแล้ว',
];

export const EXPENSE_TEMPLATE_HEADERS = [
  'วันที่จ่าย',
  'รายการค่าใช้จ่าย',
  'หมวดหมู่',
  'จำนวนเงิน',
  'ผู้เบิก/หมายเหตุ',
  'ลิงก์ใบเสร็จ',
];

export const EXPENSE_CATEGORY_OPTIONS: Array<{
  id: ExpenseCategoryId;
  label: string;
  colorHex: string;
}> = [
  { id: 'venue', label: 'ค่าสถานที่ / จัดงาน', colorHex: '#7C3AED' },
  { id: 'food', label: 'ค่าอาหารและเครื่องดื่ม', colorHex: '#EA580C' },
  { id: 'equipment', label: 'ค่าอุปกรณ์ / เวที / แสงสีเสียง', colorHex: '#0284C7' },
  { id: 'staff', label: 'ค่าทีมงาน / สตาฟ / นักแสดง', colorHex: '#0D9488' },
  { id: 'marketing', label: 'ค่าประชาสัมพันธ์ / สิ่งพิมพ์', colorHex: '#DB2777' },
  { id: 'other', label: 'ค่าใช้จ่ายอื่นๆ', colorHex: '#475569' },
];

export function getExpenseCategoryLabel(id: ExpenseCategoryId): string {
  return (
    EXPENSE_CATEGORY_OPTIONS.find((c) => c.id === id)?.label || 'ค่าใช้จ่ายอื่นๆ'
  );
}

export function matchExpenseCategoryByText(rawText: string): {
  id: ExpenseCategoryId;
  label: string;
} {
  const norm = String(rawText || '').trim().toLowerCase();
  if (norm.includes('สถานที่') || norm.includes('venue') || norm.includes('เช่า')) {
    return { id: 'venue', label: getExpenseCategoryLabel('venue') };
  }
  if (norm.includes('อาหาร') || norm.includes('เครื่องดื่ม') || norm.includes('โต๊ะจีน') || norm.includes('food')) {
    return { id: 'food', label: getExpenseCategoryLabel('food') };
  }
  if (norm.includes('อุปกรณ์') || norm.includes('เวที') || norm.includes('เสียง') || norm.includes('ไฟ')) {
    return { id: 'equipment', label: getExpenseCategoryLabel('equipment') };
  }
  if (norm.includes('ทีมงาน') || norm.includes('สตาฟ') || norm.includes('staff') || norm.includes('นักแสดง')) {
    return { id: 'staff', label: getExpenseCategoryLabel('staff') };
  }
  if (norm.includes('ประชาสัมพันธ์') || norm.includes('ป้าย') || norm.includes('พิมพ์')) {
    return { id: 'marketing', label: getExpenseCategoryLabel('marketing') };
  }
  return { id: 'other', label: getExpenseCategoryLabel('other') };
}

export interface ParsedSheetData {
  sheetName: string;
  rows: string[][];
  formulaRows: string[][];
  dataRowCount: number;
}

export interface ParsedExcelWorkbook {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, ParsedSheetData>;
}

/**
 * Clean header string for resilient comparison
 */
export function normalizeHeader(text: string): string {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Normalize table number for exact search (removes spaces, uppercases)
 */
export function normalizeTableNo(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Compact table number (removes hyphens/underscores/spaces) for secondary resilient matching
 */
export function compactTableNo(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\s\-_]+/g, '')
    .toUpperCase();
}

/**
 * Strict Column G (โอนแล้ว) evaluation rule:
 * - TRUE / TRUE Checkbox / Yes / โอนแล้ว = ชำระแล้ว (true)
 * - FALSE / FALSE Checkbox / No / ยังไม่โอน / ว่าง = ยังไม่ยืนยันการชำระ (false)
 * Never guess from transfer amount!
 */
export function evaluatePaidStatus(rawPaidValue: unknown): boolean {
  if (typeof rawPaidValue === 'boolean') {
    return rawPaidValue === true;
  }
  const normalized = String(rawPaidValue ?? '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  const negativeValues = new Set([
    'false',
    'no',
    'ยังไม่โอน',
    'ยังไม่ชำระ',
    'ยังไม่ยืนยัน',
    'ยังไม่ยืนยันการชำระ',
    '0',
    '-',
    'none',
    'null',
    'n/a',
  ]);
  if (negativeValues.has(normalized) || normalized.includes('ยังไม่')) {
    return false;
  }

  const positiveValues = new Set([
    'true',
    'yes',
    'โอนแล้ว',
    'ชำระแล้ว',
    'จ่ายแล้ว',
    'ยืนยันแล้ว',
    'paid',
    'y',
    '1',
    '✓',
    '✔',
  ]);

  return positiveValues.has(normalized);
}

/**
 * Evaluate Check-In status from cell value
 */
export function evaluateCheckedInStatus(rawVal: unknown): boolean {
  if (typeof rawVal === 'boolean') return rawVal;
  const normalized = String(rawVal ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('ยังไม่') || normalized === 'false' || normalized === '0' || normalized === '-') {
    return false;
  }
  const positive = new Set([
    'true',
    'yes',
    'เช็คอินแล้ว',
    'เช็คอิน',
    'เข้างานแล้ว',
    'มาแล้ว',
    'checkedin',
    'checked-in',
    '1',
    '✓',
    '✔',
  ]);
  return positive.has(normalized) || normalized.includes('เช็คอินแล้ว') || normalized.includes('เข้างานแล้ว');
}

/**
 * Evaluate Ticket Collection (รับบัตรแล้ว) status from cell value
 */
export function evaluateTicketCollectedStatus(rawVal: unknown): boolean {
  if (typeof rawVal === 'boolean') return rawVal;
  const normalized = String(rawVal ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes('ยังไม่') ||
    normalized === 'false' ||
    normalized === '0' ||
    normalized === '-'
  ) {
    return false;
  }
  const positive = new Set([
    'true',
    'yes',
    'รับบัตรแล้ว',
    'รับบัตร',
    'รับแล้ว',
    'แจกบัตรแล้ว',
    'collected',
    'ticketed',
    '1',
    '✓',
    '✔',
  ]);
  return (
    positive.has(normalized) ||
    normalized.includes('รับบัตรแล้ว') ||
    normalized.includes('แจกบัตรแล้ว')
  );
}

/**
 * Parse numeric transfer amount safely (handles commas, "บาท", "฿", spaces)
 */
export function parseTransferAmount(rawAmount: unknown): number {
  if (typeof rawAmount === 'number') {
    return Number.isFinite(rawAmount) ? rawAmount : 0;
  }
  const cleaned = String(rawAmount ?? '')
    .replace(/[,฿\s]|บาท|thb/gi, '')
    .trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Extract valid URL from cell text or =HYPERLINK("url", "label") formula
 */
export function extractSlipUrl(rawCell: unknown, formulaCell?: unknown): string {
  const candidates = [formulaCell, rawCell]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);

  for (const text of candidates) {
    if (text.startsWith('data:image/')) {
      return text;
    }
    const formulaLinkMatch = text.match(/(?:HYPERLINK|IMAGE)\s*\(\s*["']([^"']+)["']/i);
    if (formulaLinkMatch?.[1]) {
      return formulaLinkMatch[1].trim();
    }
    const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch?.[0]) {
      return urlMatch[0].trim();
    }
    if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)\//i.test(text)) {
      return `https://${text}`;
    }
  }

  const fallback = String(rawCell ?? '').trim();
  const ignoreTokens = new Set(['-', 'ไม่มี', 'ไม่มีสลิป', 'none', 'n/a', 'null', 'false']);
  if (!fallback || ignoreTokens.has(fallback.toLowerCase())) {
    return '';
  }

  return /^(https?:\/\/|data:image\/)/i.test(fallback) ? fallback : '';
}

/**
 * Resolve column indices from a candidate header row
 */
export function resolveColumnMapFromRow(headerRow: string[]): {
  columnMap: SheetColumnMap;
  matchCount: number;
} {
  const normalizedHeaders = headerRow.map(normalizeHeader);

  const findIndexByAliases = (
    aliases: string[],
    fallbackIdx: number
  ): { idx: number; matched: boolean } => {
    const normalizedAliases = aliases.map(normalizeHeader);
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (normalizedAliases.includes(normalizedHeaders[i])) {
        return { idx: i, matched: true };
      }
    }
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const h = normalizedHeaders[i];
      if (!h) continue;
      if (normalizedAliases.some((alias) => h.includes(alias))) {
        return { idx: i, matched: true };
      }
    }
    return { idx: fallbackIdx, matched: false };
  };

  const colA = findIndexByAliases(
    ['เลขโต๊ะ', 'โต๊ะ', 'หมายเลขโต๊ะ', 'เบอร์โต๊ะ', 'tableno', 'tablenumber', 'table', 'seat'],
    0
  );
  const colB = findIndexByAliases(
    ['ชื่อ-นามสกุล', 'ชื่อนามสกุล', 'ชื่อผู้จอง', 'ชื่อลูกค้า', 'ชื่อ', 'fullname', 'name', 'customer'],
    1
  );
  const colC = findIndexByAliases(
    ['เบอร์โทร', 'เบอร์โทรศัพท์', 'โทรศัพท์', 'โทร', 'phone', 'tel', 'mobile'],
    2
  );
  const colD = findIndexByAliases(
    ['ยอดโอน', 'จำนวนเงิน', 'ยอดชำระ', 'ยอดเงิน', 'ราคา', 'amount', 'transferamount', 'total'],
    3
  );
  const colE = findIndexByAliases(
    ['วันที่โอน', 'เวลาโอน', 'วันเวลาโอน', 'วันที่ชำระ', 'วันที่', 'transferdate', 'date'],
    4
  );
  const colF = findIndexByAliases(
    [
      'ลิ้งค์สลีป',
      'ลิงก์สลิป',
      'ลิ้งค์สลิป',
      'ลิงค์สลีป',
      'ลิงค์สลิป',
      'สลีป',
      'สลิป',
      'หลักฐานการโอน',
      'หลักฐาน',
      'slip',
      'sliplink',
      'slipurl',
    ],
    5
  );
  const colG = findIndexByAliases(
    ['โอนแล้ว', 'สถานะการโอน', 'สถานะชำระเงิน', 'สถานะ', 'ชำระแล้ว', 'paid', 'status'],
    6
  );
  const colH = findIndexByAliases(
    ['เช็คอินแล้ว', 'เช็คอิน', 'สถานะเช็คอิน', 'เข้างานแล้ว', 'checkin', 'checkedin'],
    7
  );
  const colI = findIndexByAliases(
    ['เวลาเช็คอิน', 'วันเวลาเช็คอิน', 'checkintime', 'checkedinat'],
    8
  );
  const colJ = findIndexByAliases(
    ['รับบัตรแล้ว', 'รับบัตร', 'สถานะรับบัตร', 'แจกบัตรแล้ว', 'ticketcollected', 'ticketstatus'],
    9
  );
  const colK = findIndexByAliases(
    ['เวลารับบัตร', 'วันเวลารับบัตร', 'tickettime', 'ticketcollectedat'],
    10
  );
  const colL = findIndexByAliases(
    ['หมายเหตุ', 'บันทึก', 'บันทึกเพิ่มเติม', 'รายละเอียดเพิ่มเติม', 'note', 'notes', 'remark', 'remarks'],
    11
  );
  const colM = findIndexByAliases(
    [
      'ลิ้งค์สลีป2',
      'ลิงก์สลิป2',
      'ลิ้งค์สลิป2',
      'ลิงค์สลีป2',
      'สลิป2',
      'สลีป2',
      'สลิปที่2',
      'สลีปที่2',
      'หลักฐานการโอน2',
      'หลักฐาน2',
      'slip2',
      'slipurl2',
      'sliplink2',
    ],
    12
  );

  const matches = [colA, colB, colC, colD, colE, colF, colG].filter((c) => c.matched).length;

  return {
    columnMap: {
      tableNumberIdx: colA.idx,
      fullNameIdx: colB.idx,
      phoneIdx: colC.idx,
      transferAmountIdx: colD.idx,
      transferDateIdx: colE.idx,
      slipUrlIdx: colF.idx,
      paidStatusIdx: colG.idx,
      checkedInStatusIdx: colH.matched ? colH.idx : 7,
      checkedInAtIdx: colI.matched ? colI.idx : 8,
      ticketStatusIdx: colJ.matched ? colJ.idx : 9,
      ticketCollectedAtIdx: colK.matched ? colK.idx : 10,
      noteIdx: colL.matched ? colL.idx : 11,
      slipUrl2Idx: colM.matched ? colM.idx : 12,
      headers: headerRow.map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim()),
      matchedByHeader: matches > 0,
    },
    matchCount: matches,
  };
}

/**
 * Smart Multi-Row Header Scanner:
 * Scans the first 20 rows of a sheet to locate the actual header row
 * (handles Excel sheets that have a title banner or blank rows at the top).
 */
export function scanHeaderRowAndResolveColumnMap(rows: string[][]): {
  headerRowIndex: number;
  columnMap: SheetColumnMap;
} {
  if (rows.length === 0) {
    const fallback = resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS);
    return { headerRowIndex: -1, columnMap: fallback.columnMap };
  }

  let bestRowIdx = 0;
  let bestMatchCount = -1;
  let bestColumnMap: SheetColumnMap | null = null;

  const scanLimit = Math.min(rows.length, 20);
  for (let r = 0; r < scanLimit; r++) {
    const candidateRow = (rows[r] || []).map((c) => String(c ?? ''));
    const { columnMap, matchCount } = resolveColumnMapFromRow(candidateRow);
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestRowIdx = r;
      bestColumnMap = columnMap;
    }
    // If we found at least 3 matching headers, we found the exact header row
    if (matchCount >= 3) {
      break;
    }
  }

  if (!bestColumnMap || bestMatchCount === 0) {
    // Fallback to row 0 with A-G default mapping
    const fallback = resolveColumnMapFromRow((rows[0] || []).map((c) => String(c ?? '')));
    const firstCell = normalizeHeader(rows[0]?.[0] || '');
    const isHeader =
      firstCell.includes('เลขโต๊ะ') || firstCell.includes('โต๊ะ') || firstCell.includes('table');
    return {
      headerRowIndex: isHeader ? 0 : -1,
      columnMap: fallback.columnMap,
    };
  }

  return {
    headerRowIndex: bestRowIdx,
    columnMap: bestColumnMap,
  };
}

/**
 * Converts 2D sheet rows into a CategorySheetResult on the client or server
 */
export function parseSheetRowsToCategoryResult(
  rows: string[][],
  formulaRows: string[][],
  cat: { id: string; name: string },
  actualSheetTitle: string
): CategorySheetResult {
  if (!rows || rows.length === 0) {
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      sheetName: actualSheetTitle,
      foundSheet: true,
      columnMap: resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap,
      records: [],
    };
  }

  const { headerRowIndex, columnMap } = scanHeaderRowAndResolveColumnMap(rows);
  const startRowIdx = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

  const records: SeatRecord[] = [];
  for (let r = startRowIdx; r < rows.length; r++) {
    const row = rows[r] || [];
    const formulaRow = formulaRows[r] || [];

    const rawTableNo = String(row[columnMap.tableNumberIdx] ?? '').trim();
    const fullName = String(row[columnMap.fullNameIdx] ?? '').trim();
    const phone = String(row[columnMap.phoneIdx] ?? '').trim();
    const rawTransferAmount = String(row[columnMap.transferAmountIdx] ?? '').trim();
    const transferAmount = parseTransferAmount(rawTransferAmount);
    const transferDate = String(row[columnMap.transferDateIdx] ?? '').trim();

    const rawSlipCell = row[columnMap.slipUrlIdx];
    const formulaSlipCell = formulaRow[columnMap.slipUrlIdx];
    const slipUrl = extractSlipUrl(rawSlipCell, formulaSlipCell);

    const rawSlip2Cell =
      columnMap.slipUrl2Idx !== undefined ? row[columnMap.slipUrl2Idx] : '';
    const formulaSlip2Cell =
      columnMap.slipUrl2Idx !== undefined ? formulaRow[columnMap.slipUrl2Idx] : '';
    const slipUrl2 = extractSlipUrl(rawSlip2Cell, formulaSlip2Cell);

    const rawPaidCell = row[columnMap.paidStatusIdx];
    const rawPaidStatus = String(rawPaidCell ?? '').trim();
    // STRICT RULE: Evaluate payment status exclusively from Column G (โอนแล้ว), never from transferAmount!
    const isPaid = evaluatePaidStatus(rawPaidCell);

    const rawCheckedInCell =
      columnMap.checkedInStatusIdx !== undefined ? row[columnMap.checkedInStatusIdx] : '';
    const isCheckedIn = evaluateCheckedInStatus(rawCheckedInCell);
    const checkedInAt =
      columnMap.checkedInAtIdx !== undefined
        ? String(row[columnMap.checkedInAtIdx] ?? '').trim()
        : '';

    const rawTicketCell =
      columnMap.ticketStatusIdx !== undefined ? row[columnMap.ticketStatusIdx] : '';
    const isTicketCollected = evaluateTicketCollectedStatus(rawTicketCell);
    const ticketCollectedAt =
      columnMap.ticketCollectedAtIdx !== undefined
        ? String(row[columnMap.ticketCollectedAtIdx] ?? '').trim()
        : '';

    const rawNote =
      columnMap.noteIdx !== undefined
        ? String(row[columnMap.noteIdx] ?? '').trim()
        : '';
    const note = rawNote === '-' ? '' : rawNote;

    // Skip completely blank rows
    if (
      !rawTableNo &&
      !fullName &&
      !phone &&
      !rawTransferAmount &&
      !transferDate &&
      !slipUrl &&
      !slipUrl2 &&
      !rawPaidStatus &&
      !note
    ) {
      continue;
    }

    // Skip repeated header rows
    if (normalizeHeader(rawTableNo) === 'เลขโต๊ะ') {
      continue;
    }

    const tableNumber = rawTableNo || `แถวที่ ${r + 1}`;
    const normalizedTableNumber = normalizeTableNo(tableNumber);
    const compactTableNumber = compactTableNo(tableNumber);

    const hasCustomerName =
      Boolean(fullName) &&
      !['-', 'ว่าง', 'ไม่มี', 'empty', 'available'].includes(fullName.toLowerCase());
    const hasBookingData =
      hasCustomerName ||
      Boolean(phone && phone !== '-') ||
      transferAmount > 0 ||
      Boolean(slipUrl) ||
      Boolean(slipUrl2) ||
      isPaid ||
      isCheckedIn ||
      isTicketCollected;

    records.push({
      id: `${cat.id}-row-${r + 1}-${normalizedTableNumber}`,
      rowNumber: r + 1,
      categoryId: cat.id,
      categoryName: cat.name,
      sheetName: actualSheetTitle,
      tableNumber,
      normalizedTableNumber,
      compactTableNumber,
      fullName: hasCustomerName ? fullName : '',
      phone: phone === '-' ? '' : phone,
      transferAmount,
      rawTransferAmount,
      transferDate: transferDate === '-' ? '' : transferDate,
      slipUrl,
      slipUrl2,
      rawPaidStatus,
      isPaid,
      isBooked: hasBookingData,
      isCheckedIn,
      checkedInAt: checkedInAt === '-' ? '' : checkedInAt,
      isTicketCollected,
      ticketCollectedAt: ticketCollectedAt === '-' ? '' : ticketCollectedAt,
      note,
    });
  }

  return {
    categoryId: cat.id,
    categoryName: cat.name,
    sheetName: actualSheetTitle,
    foundSheet: true,
    columnMap,
    records,
  };
}

/**
 * Builds a complete BatchReadResponse directly on the client from uploaded Excel template sheets
 */
export function buildBatchReadResponseFromSheets(
  categories: CategoryConfig[],
  sheets: TemplateSheetPayload[],
  title = 'นำเข้าจากแม่แบบ Excel (VIP & Standard)',
  availableSheets?: string[]
): BatchReadResponse {
  const categoryResults: CategorySheetResult[] = categories.map((cat) => {
    const uploaded = sheets.find((s) => s.categoryId === cat.id);
    if (!uploaded) {
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        sheetName: cat.sheetName,
        foundSheet: false,
        columnMap: null,
        records: [],
        error: `ไม่ได้เลือกแผ่นงานสำหรับประเภท "${cat.name}"`,
      };
    }

    const rows = Array.isArray(uploaded.rows) ? uploaded.rows : [];
    const formulaRows = Array.isArray(uploaded.formulaRows) ? uploaded.formulaRows : [];

    return parseSheetRowsToCategoryResult(
      rows,
      formulaRows,
      { id: cat.id, name: cat.name },
      uploaded.sheetName || uploaded.fileName || cat.sheetName
    );
  });

  return {
    spreadsheetId: 'template-import',
    spreadsheetTitle: title,
    availableSheets:
      availableSheets && availableSheets.length > 0
        ? availableSheets
        : categories.map((c) => c.sheetName),
    categoryResults,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Generates pre-numbered blank table rows for a category so the template has ready-to-use table numbers
 * (with all customer booking fields blank and โอนแล้ว = FALSE).
 */
function buildPreNumberedTemplateRows(categoryName: string, count: number): string[][] {
  const isVip = categoryName.trim().toLowerCase().includes('vip');
  const prefix = isVip ? 'VIP-' : 'A';
  const rows: string[][] = [STANDARD_TEMPLATE_HEADERS];

  for (let i = 1; i <= count; i++) {
    const numStr = String(i).padStart(2, '0');
    rows.push([`${prefix}${numStr}`, '', '', '', '', '', 'FALSE']);
  }

  return rows;
}

/**
 * Creates an instant ready-to-use blank template response (VIP-01..VIP-20 & A01..A30)
 * so the user can open and use the Seat Map, Lookup, and Dashboard immediately.
 */
export function createInitialTemplateResponse(categories: CategoryConfig[]): BatchReadResponse {
  const payloads: TemplateSheetPayload[] = categories.map((cat) => {
    const isVip = cat.name.trim().toLowerCase().includes('vip');
    const rows = buildPreNumberedTemplateRows(cat.name, isVip ? 20 : 30);
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      sheetName: cat.sheetName,
      rows,
      formulaRows: rows.map(() => ['', '', '', '', '', '', '']),
    };
  });

  return buildBatchReadResponseFromSheets(
    categories,
    payloads,
    'แม่แบบมาตรฐาน Excel (VIP & Standard)',
    categories.map((c) => c.sheetName)
  );
}

/**
 * Helper to cleanly recalculate all derived SeatRecord fields whenever a record is edited or added
 */
export function buildUpdatedSeatRecord(
  base: SeatRecord,
  patch: Partial<SeatRecord>
): SeatRecord {
  const merged = { ...base, ...patch };
  const tableNumber = String(merged.tableNumber || '').trim() || base.tableNumber;
  const normalizedTableNumber = normalizeTableNo(tableNumber);
  const compactTableNumber = compactTableNo(tableNumber);

  const fullName = String(merged.fullName ?? '').trim();
  const phone = String(merged.phone ?? '').trim();
  const transferAmount =
    typeof patch.transferAmount === 'number'
      ? Math.max(0, patch.transferAmount)
      : parseTransferAmount(merged.rawTransferAmount ?? merged.transferAmount);
  const rawTransferAmount =
    transferAmount > 0 ? String(transferAmount) : String(merged.rawTransferAmount ?? '').trim();
  const transferDate = String(merged.transferDate ?? '').trim();
  const slipUrl = String(merged.slipUrl ?? '').trim();
  const slipUrl2 = String(merged.slipUrl2 ?? '').trim();
  const isPaid = Boolean(merged.isPaid);
  const rawPaidStatus = isPaid ? 'TRUE' : 'FALSE';
  const isCheckedIn = Boolean(merged.isCheckedIn);
  const checkedInAt = isCheckedIn ? String(merged.checkedInAt ?? '').trim() : '';
  const isTicketCollected = Boolean(merged.isTicketCollected);
  const ticketCollectedAt = isTicketCollected
    ? String(merged.ticketCollectedAt ?? '').trim()
    : '';
  const rawNote = String(merged.note ?? '').trim();
  const note = rawNote === '-' ? '' : rawNote;

  const hasCustomerName =
    Boolean(fullName) &&
    !['-', 'ว่าง', 'ไม่มี', 'empty', 'available'].includes(fullName.toLowerCase());
  const isBooked =
    hasCustomerName ||
    Boolean(phone && phone !== '-') ||
    transferAmount > 0 ||
    Boolean(slipUrl) ||
    Boolean(slipUrl2) ||
    isPaid ||
    isCheckedIn ||
    isTicketCollected;

  return {
    ...merged,
    tableNumber,
    normalizedTableNumber,
    compactTableNumber,
    fullName: hasCustomerName ? fullName : '',
    phone: phone === '-' ? '' : phone,
    transferAmount,
    rawTransferAmount,
    transferDate: transferDate === '-' ? '' : transferDate,
    slipUrl,
    slipUrl2,
    rawPaidStatus,
    isPaid,
    isBooked,
    isCheckedIn,
    checkedInAt,
    isTicketCollected,
    ticketCollectedAt,
    note,
  };
}

/**
 * Generates and downloads a single multi-sheet Excel (.xlsx) template file
 * containing VIP and Standard sheets (plus any custom categories) and an Expenses sheet.
 */
export function downloadExcelTemplate(categories: CategoryConfig[]) {
  const wb = XLSX.utils.book_new();

  const targetCategories =
    categories.length > 0
      ? categories
      : [
          { id: 'vip', name: 'VIP', sheetName: 'VIP', colorHex: '#D97706' },
          { id: 'standard', name: 'Standard', sheetName: 'Standard', colorHex: '#2563EB' },
        ];

  const usedNames = new Set<string>();

  for (const cat of targetCategories) {
    let rawSheetName = (cat.sheetName || cat.name || 'Sheet')
      .replace(/[\\/?*[\]:]/g, '')
      .trim()
      .slice(0, 31);
    if (!rawSheetName) rawSheetName = 'Sheet';

    let finalName = rawSheetName;
    let counter = 2;
    while (usedNames.has(finalName.toLowerCase())) {
      finalName = `${rawSheetName.slice(0, 28)}_${counter}`;
      counter++;
    }
    usedNames.add(finalName.toLowerCase());

    const isVip = cat.name.trim().toLowerCase().includes('vip');
    const sheetRows = buildPreNumberedTemplateRows(cat.name, isVip ? 20 : 30);
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);

    ws['!cols'] = [
      { wch: 14 }, // A: เลขโต๊ะ
      { wch: 26 }, // B: ชื่อ-นามสกุล
      { wch: 18 }, // C: เบอร์โทร
      { wch: 16 }, // D: ยอดโอน
      { wch: 18 }, // E: วันที่โอน
      { wch: 36 }, // F: ลิ้งค์สลีป
      { wch: 16 }, // G: โอนแล้ว
    ];

    XLSX.utils.book_append_sheet(wb, ws, finalName);
  }

  // Also append an Expenses (รายจ่าย) sheet in the template
  const expenseWs = XLSX.utils.aoa_to_sheet([EXPENSE_TEMPLATE_HEADERS]);
  expenseWs['!cols'] = [
    { wch: 16 }, // วันที่จ่าย
    { wch: 32 }, // รายการค่าใช้จ่าย
    { wch: 24 }, // หมวดหมู่
    { wch: 16 }, // จำนวนเงิน
    { wch: 28 }, // ผู้เบิก/หมายเหตุ
    { wch: 36 }, // ลิงก์ใบเสร็จ
  ];
  XLSX.utils.book_append_sheet(wb, expenseWs, 'รายจ่าย');

  XLSX.writeFile(wb, 'Seat_Booking_Template_VIP_Standard.xlsx');
}

/**
 * Builds the multi-sheet XLSX workbook containing all configured seat categories,
 * Expenses ("รายจ่าย"), and Financial Summary ("สรุปงบการเงิน").
 */
export function buildCurrentDataWorkbook(
  categories: CategoryConfig[],
  categoryResults: CategorySheetResult[],
  expenses: ExpenseRecord[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const cat of categories) {
    let rawSheetName = (cat.sheetName || cat.name || 'Sheet')
      .replace(/[\\/?*[\]:]/g, '')
      .trim()
      .slice(0, 31);
    if (!rawSheetName) rawSheetName = 'Sheet';

    let finalName = rawSheetName;
    let counter = 2;
    while (usedNames.has(finalName.toLowerCase())) {
      finalName = `${rawSheetName.slice(0, 28)}_${counter}`;
      counter++;
    }
    usedNames.add(finalName.toLowerCase());

    const catRes = categoryResults.find((r) => r.categoryId === cat.id);
    const records = catRes?.records || [];

    const rows: (string | number)[][] = [
      [
        ...STANDARD_TEMPLATE_HEADERS,
        'เช็คอินแล้ว',
        'เวลาเช็คอิน',
        'รับบัตรแล้ว',
        'เวลารับบัตร',
        'หมายเหตุ',
        'ลิ้งค์สลีป 2',
      ],
    ];
    for (const r of records) {
      rows.push([
        r.tableNumber,
        r.fullName || '',
        r.phone || '',
        r.transferAmount > 0 ? r.transferAmount : r.rawTransferAmount || '',
        r.transferDate || '',
        // Avoid dumping huge base64 strings into Excel cells (Excel cell limit is 32,767 chars)
        r.slipUrl && !r.slipUrl.startsWith('data:') ? r.slipUrl : r.slipUrl ? '[แนบรูปสลิปในระบบ]' : '',
        r.isPaid ? 'TRUE' : 'FALSE',
        r.isCheckedIn ? 'TRUE' : 'FALSE',
        r.checkedInAt || '',
        r.isTicketCollected ? 'TRUE' : 'FALSE',
        r.ticketCollectedAt || '',
        r.note || '',
        r.slipUrl2 && !r.slipUrl2.startsWith('data:') ? r.slipUrl2 : r.slipUrl2 ? '[แนบรูปสลิป 2 ในระบบ]' : '',
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 26 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 36 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
      { wch: 16 },
      { wch: 20 },
      { wch: 32 },
      { wch: 36 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, finalName);
  }

  // Sheet: รายจ่าย (Expenses)
  const expenseRows: (string | number)[][] = [EXPENSE_TEMPLATE_HEADERS];
  for (const exp of expenses) {
    expenseRows.push([
      exp.expenseDate || '',
      exp.title || '',
      exp.categoryLabel || getExpenseCategoryLabel(exp.category),
      exp.amount || 0,
      exp.payeeOrNote || '',
      exp.receiptUrl && !exp.receiptUrl.startsWith('data:')
        ? exp.receiptUrl
        : exp.receiptUrl
        ? '[แนบรูปใบเสร็จในระบบ]'
        : '',
    ]);
  }
  const expWs = XLSX.utils.aoa_to_sheet(expenseRows);
  expWs['!cols'] = [
    { wch: 16 },
    { wch: 32 },
    { wch: 26 },
    { wch: 16 },
    { wch: 28 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, expWs, 'รายจ่าย');

  // Sheet: สรุปงบการเงิน (Financial Summary)
  const allRecords = categoryResults.flatMap((r) => r.records || []);
  const paidRevenue = allRecords
    .filter((r) => r.isPaid)
    .reduce((sum, r) => sum + (r.transferAmount || 0), 0);
  const unpaidRevenue = allRecords
    .filter((r) => !r.isPaid)
    .reduce((sum, r) => sum + (r.transferAmount || 0), 0);
  const totalRevenue = paidRevenue + unpaidRevenue;
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const netProfitPaid = paidRevenue - totalExpenses;

  const summaryRows: (string | number)[][] = [
    ['รายการสรุปงบการเงิน', 'จำนวนเงิน (บาท)'],
    ['รายรับที่ยืนยันชำระแล้ว (โอนแล้ว = TRUE)', paidRevenue],
    ['ยอดโอนที่รอยืนยันการชำระ (โอนแล้ว = FALSE)', unpaidRevenue],
    ['ยอดโอนรวมทั้งหมดทุกโซน', totalRevenue],
    ['รายจ่ายรวมทั้งหมด', totalExpenses],
    ['คงเหลือสุทธิ / กำไรสุทธิ (รายรับชำระแล้ว - รายจ่ายรวม)', netProfitPaid],
  ];
  const sumWs = XLSX.utils.aoa_to_sheet(summaryRows);
  sumWs['!cols'] = [{ wch: 48 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, sumWs, 'สรุปงบการเงิน');

  return wb;
}

/**
 * Generates raw binary .xlsx bytes (Uint8Array) for real Google Drive multipart uploads.
 */
export function generateCurrentDataExcelBytes(
  categories: CategoryConfig[],
  categoryResults: CategorySheetResult[],
  expenses: ExpenseRecord[]
): Uint8Array {
  const wb = buildCurrentDataWorkbook(categories, categoryResults, expenses);
  const arrayBuffer = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer | Uint8Array;
  return arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
}

/**
 * Exports all current edited SeatRecord items across categories AND all ExpenseRecord items
 * plus a Financial Summary sheet into a ready-to-use Excel (.xlsx) file.
 */
export function exportCurrentDataToExcel(
  categories: CategoryConfig[],
  categoryResults: CategorySheetResult[],
  expenses: ExpenseRecord[],
  fileName = 'Seat_Bookings_And_Expenses_Updated.xlsx'
) {
  const wb = buildCurrentDataWorkbook(categories, categoryResults, expenses);
  XLSX.writeFile(wb, fileName);
}

/**
 * Extracts ExpenseRecord items if the uploaded Excel workbook contains an Expenses ("รายจ่าย") sheet
 */
export function parseExpensesFromWorkbook(workbook: ParsedExcelWorkbook): ExpenseRecord[] {
  const expenseSheetName = workbook.sheetNames.find((name) => {
    const n = normalizeHeader(name);
    return n.includes('รายจ่าย') || n.includes('ค่าใช้จ่าย') || n.includes('expense');
  });

  if (!expenseSheetName) return [];
  const sheet = workbook.sheets[expenseSheetName];
  if (!sheet || !sheet.rows || sheet.rows.length <= 1) return [];

  const result: ExpenseRecord[] = [];
  for (let r = 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const dateVal = String(row[0] ?? '').trim();
    const titleVal = String(row[1] ?? '').trim();
    const catVal = String(row[2] ?? '').trim();
    const amountVal = parseTransferAmount(row[3]);
    const noteVal = String(row[4] ?? '').trim();
    const receiptVal = extractSlipUrl(row[5], sheet.formulaRows?.[r]?.[5]);

    if (!titleVal && amountVal <= 0) continue;
    if (normalizeHeader(titleVal).includes('รายการค่าใช้จ่าย')) continue;

    const matchedCat = matchExpenseCategoryByText(catVal);
    result.push({
      id: `exp-import-${Date.now()}-${r}`,
      expenseDate: dateVal || new Date().toLocaleDateString('th-TH'),
      title: titleVal || `รายการค่าใช้จ่ายที่ ${r}`,
      category: matchedCat.id,
      categoryLabel: catVal || matchedCat.label,
      amount: amountVal,
      payeeOrNote: noteVal,
      receiptUrl: receiptVal,
      createdAt: new Date().toISOString(),
    });
  }
  return result;
}

/**
 * Parses raw Excel (.xlsx, .xls) or CSV binary bytes into structured sheets,
 * preserving formatted display values, dates, hyperlinks, and formulas.
 */
export function parseExcelWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string
): ParsedExcelWorkbook {
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellFormula: true,
    cellNF: true,
    cellText: true,
    cellDates: true,
  });

  const sheets: Record<string, ParsedSheetData> = {};

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) {
      sheets[sheetName] = {
        sheetName,
        rows: [],
        formulaRows: [],
        dataRowCount: 0,
      };
      continue;
    }

    const range = XLSX.utils.decode_range(ws['!ref']);
    const maxRow = Math.min(range.e.r, 3000);
    const maxCol = Math.min(range.e.c, 30);

    const rows: string[][] = [];
    const formulaRows: string[][] = [];

    for (let r = range.s.r; r <= maxRow; r++) {
      const rowCells: string[] = [];
      const formulaCells: string[] = [];
      let hasAnyValueInRow = false;

      for (let c = range.s.c; c <= maxCol; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellAddress];

        if (!cell) {
          rowCells.push('');
          formulaCells.push('');
          continue;
        }

        let displayVal = '';
        if (cell.t === 'b') {
          displayVal = cell.v ? 'TRUE' : 'FALSE';
        } else if (cell.t === 'd' && cell.v instanceof Date) {
          displayVal = cell.w || cell.v.toLocaleDateString('th-TH');
        } else if (cell.w !== undefined && String(cell.w).trim() !== '') {
          displayVal = String(cell.w).trim();
        } else if (cell.v !== undefined && cell.v !== null) {
          displayVal = String(cell.v).trim();
        }

        let formulaOrLink = '';
        if (cell.l && cell.l.Target) {
          formulaOrLink = String(cell.l.Target).trim();
        } else if (cell.f) {
          formulaOrLink = `=${cell.f}`;
        }

        if (displayVal || formulaOrLink) {
          hasAnyValueInRow = true;
        }

        rowCells.push(displayVal);
        formulaCells.push(formulaOrLink);
      }

      if (hasAnyValueInRow) {
        rows.push(rowCells);
        formulaRows.push(formulaCells);
      }
    }

    const { headerRowIndex } = scanHeaderRowAndResolveColumnMap(rows);
    const dataRowCount =
      headerRowIndex >= 0
        ? Math.max(0, rows.length - (headerRowIndex + 1))
        : rows.length;

    sheets[sheetName] = {
      sheetName,
      rows,
      formulaRows,
      dataRowCount,
    };
  }

  return {
    fileName,
    sheetNames: wb.SheetNames,
    sheets,
  };
}

/**
 * Parses an uploaded Excel (.xlsx, .xls) or CSV file into structured sheets,
 * preserving formatted display values, dates, hyperlinks, and formulas.
 */
export async function parseExcelWorkbookFile(file: File): Promise<ParsedExcelWorkbook> {
  const buffer = await file.arrayBuffer();
  return parseExcelWorkbookBuffer(buffer, file.name);
}

/**
 * Normalizes a hex color string to a valid #RRGGBB format.
 */
export function normalizeHexColor(raw: unknown, fallback = '#2563EB'): string {
  const str = String(raw ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(str)) {
    return str.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(str)) {
    const r = str[1];
    const g = str[2];
    const b = str[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

const VALID_EXPENSE_CATEGORY_IDS = new Set<ExpenseCategoryId>([
  'venue',
  'food',
  'equipment',
  'staff',
  'marketing',
  'other',
]);

const FALLBACK_DEFAULT_CATEGORIES: CategoryConfig[] = [
  { id: 'vip', name: 'VIP', sheetName: 'VIP', colorHex: '#D97706', isDefault: true },
  {
    id: 'standard',
    name: 'Standard',
    sheetName: 'Standard',
    colorHex: '#2563EB',
    isDefault: true,
  },
];

/**
 * Strictly validates and sanitizes a JSON backup payload loaded from Google Drive
 * so malformed, partial, or empty fields never crash the UI.
 */
export function validateAndHydrateCloudState(
  raw: unknown,
  fallbackCategories: CategoryConfig[] = FALLBACK_DEFAULT_CATEGORIES
): CloudSystemState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'รูปแบบไฟล์สำรอง JSON ไม่ถูกต้อง (ข้อมูลต้องเป็นออบเจ็กต์ JSON ของระบบจองโต๊ะ)'
    );
  }

  const obj = raw as Record<string, unknown>;
  const hasCategoryResults = Array.isArray(obj.categoryResults);
  const hasCategories = Array.isArray(obj.categories);
  const hasExpenses = Array.isArray(obj.expenses);

  if (!hasCategoryResults && !hasCategories && !hasExpenses) {
    throw new Error(
      'ไฟล์ JSON นี้ไม่ตรงกับโครงสร้างข้อมูลของระบบจองโต๊ะ (ไม่พบ categoryResults, categories หรือ expenses)'
    );
  }

  // 1. Validate & sanitize categories
  const rawCats = Array.isArray(obj.categories) ? obj.categories : [];
  const seenCatIds = new Set<string>();
  const sanitizedCategories: CategoryConfig[] = [];

  for (let i = 0; i < rawCats.length; i++) {
    const item = rawCats[i];
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const rawId = String(c.id ?? '').trim() || `cat-${i + 1}`;
    if (seenCatIds.has(rawId)) continue;
    seenCatIds.add(rawId);

    const name = String(c.name ?? '').trim() || rawId;
    const sheetName = String(c.sheetName ?? '').trim() || name;
    const defaultFallbackColor =
      rawId === 'vip' || name.toLowerCase().includes('vip') ? '#D97706' : '#2563EB';
    sanitizedCategories.push({
      id: rawId,
      name,
      sheetName,
      colorHex: normalizeHexColor(c.colorHex, defaultFallbackColor),
      isDefault: Boolean(c.isDefault || rawId === 'vip' || rawId === 'standard'),
    });
  }

  const finalCategories =
    sanitizedCategories.length > 0
      ? sanitizedCategories
      : fallbackCategories.length > 0
      ? fallbackCategories
      : FALLBACK_DEFAULT_CATEGORIES;

  // 2. Validate & sanitize categoryResults & every SeatRecord
  const rawResults = Array.isArray(obj.categoryResults) ? obj.categoryResults : [];
  const rawResultByCatId = new Map<string, Record<string, unknown>>();
  for (const item of rawResults) {
    if (item && typeof item === 'object') {
      const recObj = item as Record<string, unknown>;
      const catId = String(recObj.categoryId ?? '').trim();
      if (catId && !rawResultByCatId.has(catId)) {
        rawResultByCatId.set(catId, recObj);
      }
    }
  }

  const defaultColMap = resolveColumnMapFromRow(STANDARD_TEMPLATE_HEADERS).columnMap;
  const sanitizedCategoryResults: CategorySheetResult[] = finalCategories.map((cat) => {
    const rawCatRes = rawResultByCatId.get(cat.id);
    const rawRecords = Array.isArray(rawCatRes?.records) ? rawCatRes.records : [];
    const seenRecIds = new Set<string>();
    const cleanRecords: SeatRecord[] = [];

    for (let idx = 0; idx < rawRecords.length; idx++) {
      const recItem = rawRecords[idx];
      if (!recItem || typeof recItem !== 'object') continue;
      const r = recItem as Record<string, unknown>;
      const tableNo =
        String(r.tableNumber ?? '').trim() || `แถวที่ ${idx + 2}`;
      const normTable = normalizeTableNo(tableNo);
      let recId =
        String(r.id ?? '').trim() || `${cat.id}-row-${idx + 2}-${normTable}`;
      if (seenRecIds.has(recId)) {
        recId = `${recId}-${idx}`;
      }
      seenRecIds.add(recId);

      const parsedAmount = parseTransferAmount(
        r.transferAmount !== undefined ? r.transferAmount : r.rawTransferAmount
      );
      const isPaid =
        typeof r.isPaid === 'boolean'
          ? r.isPaid
          : evaluatePaidStatus(r.rawPaidStatus);
      const isCheckedIn =
        typeof r.isCheckedIn === 'boolean'
          ? r.isCheckedIn
          : evaluateCheckedInStatus(r.isCheckedIn);
      const isTicketCollected =
        typeof r.isTicketCollected === 'boolean'
          ? r.isTicketCollected
          : evaluateTicketCollectedStatus(r.isTicketCollected);

      const baseRecord: SeatRecord = {
        id: recId,
        rowNumber: Number.isFinite(Number(r.rowNumber))
          ? Math.max(1, Math.floor(Number(r.rowNumber)))
          : idx + 2,
        categoryId: cat.id,
        categoryName: cat.name,
        sheetName: String(rawCatRes?.sheetName ?? '').trim() || cat.sheetName,
        tableNumber: tableNo,
        normalizedTableNumber: normTable,
        compactTableNumber: compactTableNo(tableNo),
        fullName: String(r.fullName ?? '').trim(),
        phone: String(r.phone ?? '').trim(),
        transferAmount: parsedAmount,
        rawTransferAmount:
          r.rawTransferAmount !== undefined
            ? String(r.rawTransferAmount)
            : parsedAmount > 0
            ? String(parsedAmount)
            : '',
        transferDate: String(r.transferDate ?? '').trim(),
        slipUrl: sanitizeSafeUrl(String(r.slipUrl ?? '')),
        slipUrl2: sanitizeSafeUrl(String(r.slipUrl2 ?? '')),
        rawPaidStatus: isPaid ? 'TRUE' : 'FALSE',
        isPaid,
        isBooked: Boolean(r.isBooked),
        isCheckedIn,
        checkedInAt: String(r.checkedInAt ?? '').trim(),
        isTicketCollected,
        ticketCollectedAt: String(r.ticketCollectedAt ?? '').trim(),
        note: String(r.note ?? '').trim(),
      };

      cleanRecords.push(buildUpdatedSeatRecord(baseRecord, {}));
    }

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      sheetName: String(rawCatRes?.sheetName ?? '').trim() || cat.sheetName,
      foundSheet: rawCatRes ? rawCatRes.foundSheet !== false : true,
      columnMap:
        rawCatRes?.columnMap && typeof rawCatRes.columnMap === 'object'
          ? (rawCatRes.columnMap as SheetColumnMap)
          : defaultColMap,
      records: cleanRecords,
      error: typeof rawCatRes?.error === 'string' ? rawCatRes.error : undefined,
    };
  });

  // 3. Validate & sanitize expenses
  const rawExpenses = Array.isArray(obj.expenses) ? obj.expenses : [];
  const seenExpenseIds = new Set<string>();
  const sanitizedExpenses: ExpenseRecord[] = [];

  for (let idx = 0; idx < rawExpenses.length; idx++) {
    const item = rawExpenses[idx];
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const title = String(e.title ?? '').trim();
    const amount = Math.max(0, parseTransferAmount(e.amount));
    if (!title && amount <= 0) continue;

    let expId = String(e.id ?? '').trim() || `exp-restored-${Date.now()}-${idx}`;
    if (seenExpenseIds.has(expId)) {
      expId = `${expId}-${idx}`;
    }
    seenExpenseIds.add(expId);

    const rawCatId = String(e.category ?? '').trim() as ExpenseCategoryId;
    const resolvedCat = VALID_EXPENSE_CATEGORY_IDS.has(rawCatId)
      ? { id: rawCatId, label: getExpenseCategoryLabel(rawCatId) }
      : matchExpenseCategoryByText(String(e.categoryLabel ?? rawCatId));

    sanitizedExpenses.push({
      id: expId,
      expenseDate: String(e.expenseDate ?? '').trim() || new Date().toLocaleDateString('th-TH'),
      title: title || `รายการค่าใช้จ่ายที่ ${idx + 1}`,
      category: resolvedCat.id,
      categoryLabel: String(e.categoryLabel ?? '').trim() || resolvedCat.label,
      amount,
      payeeOrNote: String(e.payeeOrNote ?? '').trim(),
      receiptUrl: sanitizeSafeUrl(String(e.receiptUrl ?? '')),
      createdAt:
        typeof e.createdAt === 'string' && e.createdAt.trim()
          ? e.createdAt
          : new Date().toISOString(),
    });
  }

  const availableSheets = Array.isArray(obj.availableSheets)
    ? obj.availableSheets.map((s) => String(s ?? '').trim()).filter(Boolean)
    : finalCategories.map((c) => c.sheetName);

  return {
    categories: finalCategories,
    categoryResults: sanitizedCategoryResults,
    expenses: sanitizedExpenses,
    spreadsheetTitle:
      String(obj.spreadsheetTitle ?? '').trim() || 'ข้อมูลระบบจองโต๊ะ VIP & Standard',
    availableSheets,
    updatedAt:
      typeof obj.updatedAt === 'string' && obj.updatedAt.trim()
        ? obj.updatedAt
        : new Date().toISOString(),
  };
}

/**
 * Hydrates a CloudSystemState directly from an .xlsx workbook downloaded from Google Drive.
 */
export function buildCloudSystemStateFromExcelBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string,
  fallbackCategories: CategoryConfig[] = FALLBACK_DEFAULT_CATEGORIES
): CloudSystemState {
  const parsed = parseExcelWorkbookBuffer(buffer, fileName);
  if (!parsed.sheetNames.length) {
    throw new Error(`ไฟล์ Excel "${fileName}" ไม่มีแผ่นงานข้อมูล`);
  }

  const nonSeatSheetCheck = (name: string) => {
    const n = normalizeHeader(name);
    return (
      n.includes('รายจ่าย') ||
      n.includes('ค่าใช้จ่าย') ||
      n.includes('expense') ||
      n.includes('สรุปงบ') ||
      n.includes('summary')
    );
  };

  const seatSheets = parsed.sheetNames.filter((s) => !nonSeatSheetCheck(s));
  const usedSheets = new Set<string>();
  const targetCategories: CategoryConfig[] = [];
  const payloads: TemplateSheetPayload[] = [];

  for (const cat of fallbackCategories) {
    const desired = normalizeHeader(cat.sheetName || cat.name);
    const matched =
      seatSheets.find(
        (s) => !usedSheets.has(s) && normalizeHeader(s) === desired
      ) ||
      seatSheets.find(
        (s) =>
          !usedSheets.has(s) &&
          (normalizeHeader(s).includes(desired) ||
            desired.includes(normalizeHeader(s)))
      );

    if (matched && parsed.sheets[matched]) {
      usedSheets.add(matched);
      targetCategories.push({ ...cat, sheetName: matched });
      payloads.push({
        categoryId: cat.id,
        categoryName: cat.name,
        sheetName: matched,
        rows: parsed.sheets[matched].rows,
        formulaRows: parsed.sheets[matched].formulaRows,
        fileName,
      });
    }
  }

  // Include any additional seat sheets that were not in fallbackCategories
  const extraColors = ['#7C3AED', '#0891B2', '#0D9488', '#DB2777', '#4F46E5'];
  let extraIdx = 0;
  for (const sheetName of seatSheets) {
    if (usedSheets.has(sheetName)) continue;
    const sheetData = parsed.sheets[sheetName];
    if (!sheetData) continue;
    const newId = `cat-drive-${normalizeHeader(sheetName) || extraIdx}`;
    const colorHex = extraColors[extraIdx % extraColors.length];
    extraIdx++;
    targetCategories.push({
      id: newId,
      name: sheetName,
      sheetName,
      colorHex,
      isDefault: false,
    });
    payloads.push({
      categoryId: newId,
      categoryName: sheetName,
      sheetName,
      rows: sheetData.rows,
      formulaRows: sheetData.formulaRows,
      fileName,
    });
  }

  const finalCategories =
    targetCategories.length > 0 ? targetCategories : fallbackCategories;

  const batch = buildBatchReadResponseFromSheets(
    finalCategories,
    payloads,
    `กู้คืนจาก Google Drive (${fileName})`,
    parsed.sheetNames
  );
  const importedExpenses = parseExpensesFromWorkbook(parsed);

  return validateAndHydrateCloudState(
    {
      categories: finalCategories,
      categoryResults: batch.categoryResults,
      expenses: importedExpenses,
      spreadsheetTitle: batch.spreadsheetTitle,
      availableSheets: batch.availableSheets,
      updatedAt: new Date().toISOString(),
    },
    finalCategories
  );
}


