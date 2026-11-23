import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));

interface CategoryQueryInput {
  id: string;
  name: string;
  sheetName: string;
}

interface TemplateSheetUploadInput {
  categoryId: string;
  categoryName: string;
  sheetName: string;
  rows?: string[][];
  formulaRows?: string[][];
  csvContent?: string;
  fileName?: string;
}

interface SheetColumnMap {
  tableNumberIdx: number;
  fullNameIdx: number;
  phoneIdx: number;
  transferAmountIdx: number;
  transferDateIdx: number;
  slipUrlIdx: number;
  paidStatusIdx: number;
  noteIdx?: number;
  slipUrl2Idx?: number;
  headers: string[];
  matchedByHeader: boolean;
}

function normalizeHeader(text: string): string {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeTableNo(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function compactTableNo(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\s\-_]+/g, '')
    .toUpperCase();
}

function evaluatePaidStatus(rawPaidValue: unknown): boolean {
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

function parseTransferAmount(rawAmount: unknown): number {
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

function extractSlipUrl(rawCell: unknown, formulaCell?: unknown): string {
  const candidates = [formulaCell, rawCell]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);

  for (const text of candidates) {
    const hyperlinkMatch = text.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (hyperlinkMatch?.[1]) {
      return hyperlinkMatch[1].trim();
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

  return /^https?:\/\//i.test(fallback) ? fallback : '';
}

function resolveColumnMapFromRow(headerRow: string[]): {
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

  const colA = findIndexByAliases(['เลขโต๊ะ', 'โต๊ะ', 'หมายเลขโต๊ะ', 'เบอร์โต๊ะ', 'tableno', 'tablenumber', 'table', 'seat'], 0);
  const colB = findIndexByAliases(['ชื่อ-นามสกุล', 'ชื่อนามสกุล', 'ชื่อผู้จอง', 'ชื่อลูกค้า', 'ชื่อ', 'fullname', 'name', 'customer'], 1);
  const colC = findIndexByAliases(['เบอร์โทร', 'เบอร์โทรศัพท์', 'โทรศัพท์', 'โทร', 'phone', 'tel', 'mobile'], 2);
  const colD = findIndexByAliases(['ยอดโอน', 'จำนวนเงิน', 'ยอดชำระ', 'ยอดเงิน', 'ราคา', 'amount', 'transferamount', 'total'], 3);
  const colE = findIndexByAliases(['วันที่โอน', 'เวลาโอน', 'วันเวลาโอน', 'วันที่ชำระ', 'วันที่', 'transferdate', 'date'], 4);
  const colF = findIndexByAliases(['ลิ้งค์สลีป', 'ลิงก์สลิป', 'ลิ้งค์สลิป', 'ลิงค์สลีป', 'ลิงค์สลิป', 'สลีป', 'สลิป', 'หลักฐานการโอน', 'หลักฐาน', 'slip', 'sliplink', 'slipurl'], 5);
  const colG = findIndexByAliases(['โอนแล้ว', 'สถานะการโอน', 'สถานะชำระเงิน', 'สถานะ', 'ชำระแล้ว', 'paid', 'status'], 6);
  const colL = findIndexByAliases(['หมายเหตุ', 'บันทึก', 'บันทึกเพิ่มเติม', 'รายละเอียดเพิ่มเติม', 'note', 'notes', 'remark', 'remarks'], 11);
  const colM = findIndexByAliases(['ลิ้งค์สลีป2', 'ลิงก์สลิป2', 'ลิ้งค์สลิป2', 'ลิงค์สลีป2', 'สลิป2', 'สลีป2', 'สลิปที่2', 'สลีปที่2', 'หลักฐานการโอน2', 'หลักฐาน2', 'slip2', 'slipurl2', 'sliplink2'], 12);

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
      noteIdx: colL.matched ? colL.idx : 11,
      slipUrl2Idx: colM.matched ? colM.idx : 12,
      headers: headerRow.map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim()),
      matchedByHeader: matches > 0,
    },
    matchCount: matches,
  };
}

function scanHeaderRowAndResolveColumnMap(rows: string[][]): {
  headerRowIndex: number;
  columnMap: SheetColumnMap;
} {
  if (rows.length === 0) {
    const fallback = resolveColumnMapFromRow(['เลขโต๊ะ', 'ชื่อ-นามสกุล', 'เบอร์โทร', 'ยอดโอน', 'วันที่โอน', 'ลิ้งค์สลีป', 'โอนแล้ว']);
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
    if (matchCount >= 3) {
      break;
    }
  }

  if (!bestColumnMap || bestMatchCount === 0) {
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

function parseSheetRowsToRecords(
  rows: string[][],
  formulaRows: any[][],
  cat: { id: string; name: string },
  actualSheetTitle: string
) {
  if (!rows || rows.length === 0) {
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      sheetName: actualSheetTitle,
      foundSheet: true,
      columnMap: null,
      records: [],
    };
  }

  const { headerRowIndex, columnMap } = scanHeaderRowAndResolveColumnMap(rows);
  const startRowIdx = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

  const records = [];
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
    const isPaid = evaluatePaidStatus(rawPaidCell);
    const rawNote =
      columnMap.noteIdx !== undefined
        ? String(row[columnMap.noteIdx] ?? '').trim()
        : '';
    const note = rawNote === '-' ? '' : rawNote;

    if (!rawTableNo && !fullName && !phone && !rawTransferAmount && !transferDate && !slipUrl && !slipUrl2 && !rawPaidStatus && !note) {
      continue;
    }

    if (normalizeHeader(rawTableNo) === 'เลขโต๊ะ') {
      continue;
    }

    const tableNumber = rawTableNo || `แถวที่ ${r + 1}`;
    const normalizedTableNumber = normalizeTableNo(tableNumber);
    const compactTableNumber = compactTableNo(tableNumber);

    const hasCustomerName =
      Boolean(fullName) && !['-', 'ว่าง', 'ไม่มี', 'empty', 'available'].includes(fullName.toLowerCase());
    const hasBookingData =
      hasCustomerName || Boolean(phone && phone !== '-') || transferAmount > 0 || Boolean(slipUrl) || Boolean(slipUrl2) || isPaid;

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

function parseDelimitedTextTo2DArray(rawText: string): string[][] {
  const cleanText = String(rawText || '').replace(/^\uFEFF/, '');
  const firstLineEnd = cleanText.indexOf('\n');
  const firstLine = firstLineEnd >= 0 ? cleanText.slice(0, firstLineEnd) : cleanText;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? '\t' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    const nextCh = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (ch === '\r' && nextCh === '\n') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function decodeHtmlEntities(str: string): string {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Fallback reader via Google Visualization endpoint when a Google Sheet is shared
 */
async function fetchSharedSheetViaGviz(
  spreadsheetId: string,
  token: string | null
): Promise<{ title: string; sheetTitles: string[] }> {
  const htmlViewUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/htmlview`;
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; SeatBookingLookup/1.0)',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(htmlViewUrl, { headers });
  if (!res.ok) {
    throw new Error('ไม่สามารถเข้าถึงไฟล์ Google Sheets ได้');
  }

  const html = await res.text();
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  let title = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1].trim()) : 'Google Sheets';
  title = title.replace(/\s*-\s*Google\s*(Sheets|ชีต|Drive)$/i, '').trim() || 'Google Sheets';

  const sheetTitles: string[] = [];
  const pushMatches = html.matchAll(/items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"/g);
  for (const m of pushMatches) {
    if (m[1]) {
      const decoded = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (!sheetTitles.includes(decoded)) {
        sheetTitles.push(decoded);
      }
    }
  }

  if (sheetTitles.length === 0) {
    const tabMatches = html.matchAll(/id=["']sheet-button-[^"']+["'][^>]*>\s*<a[^>]*>([^<]+)<\/a>/gi);
    for (const m of tabMatches) {
      if (m[1]) {
        const name = decodeHtmlEntities(m[1].trim());
        if (name && !sheetTitles.includes(name)) {
          sheetTitles.push(name);
        }
      }
    }
  }

  return { title, sheetTitles };
}

async function fetchSheetCsvViaGviz(
  spreadsheetId: string,
  sheetName: string,
  token: string | null
): Promise<string[][]> {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    spreadsheetId
  )}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; SeatBookingLookup/1.0)',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(csvUrl, { headers });
  if (!res.ok) {
    throw new Error(`ไม่สามารถอ่านแผ่นงาน "${sheetName}" ได้`);
  }
  const text = await res.text();
  return parseDelimitedTextTo2DArray(text);
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token && token !== 'null' && token !== 'undefined' ? token : null;
}

/**
 * POST /api/sheets/import-template
 */
app.post('/api/sheets/import-template', (req: Request, res: Response) => {
  try {
    const sheets: TemplateSheetUploadInput[] = Array.isArray(req.body?.sheets) ? req.body.sheets : [];
    const categories: CategoryQueryInput[] = Array.isArray(req.body?.categories)
      ? req.body.categories
      : [
          { id: 'vip', name: 'VIP', sheetName: 'VIP' },
          { id: 'standard', name: 'Standard', sheetName: 'Standard' },
        ];

    const categoryResults = categories.map((cat) => {
      const uploaded = sheets.find((s) => s.categoryId === cat.id);
      if (!uploaded) {
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          sheetName: cat.sheetName,
          foundSheet: false,
          columnMap: null,
          records: [],
          error: `ยังไม่ได้เลือกแผ่นงานสำหรับประเภท "${cat.name}"`,
        };
      }

      const rows = Array.isArray(uploaded.rows)
        ? uploaded.rows
        : uploaded.csvContent
        ? parseDelimitedTextTo2DArray(uploaded.csvContent)
        : [];
      const formulaRows = Array.isArray(uploaded.formulaRows) ? uploaded.formulaRows : [];

      return parseSheetRowsToRecords(
        rows,
        formulaRows,
        { id: cat.id, name: cat.name },
        uploaded.sheetName || uploaded.fileName || cat.sheetName
      );
    });

    res.json({
      spreadsheetId: 'template-import',
      spreadsheetTitle: String(req.body?.title || 'นำเข้าจากแม่แบบ Excel (VIP & Standard)'),
      availableSheets: Array.isArray(req.body?.availableSheets)
        ? req.body.availableSheets
        : categories.map((c) => c.sheetName),
      categoryResults,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error importing Excel template:', error);
    res.status(400).json({
      error: error?.message || 'เกิดข้อผิดพลาดในการอ่านข้อมูลจากไฟล์แม่แบบ Excel',
    });
  }
});

/**
 * GET /api/drive/spreadsheets
 */
app.get('/api/drive/spreadsheets', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.json({ files: [] });
      return;
    }

    const searchQuery = String(req.query.q || '').trim();
    const filterMode = String(req.query.filter || 'all').trim();

    let q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    if (filterMode === 'sharedWithMe') {
      q += ' and sharedWithMe=true';
    }
    if (searchQuery) {
      const escaped = searchQuery.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      q += ` and name contains '${escaped}'`;
    }

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', q);
    url.searchParams.set('pageSize', '40');
    url.searchParams.set('orderBy', filterMode === 'sharedWithMe' ? 'sharedWithMeTime desc' : 'modifiedTime desc');
    url.searchParams.set(
      'fields',
      'files(id,name,modifiedTime,webViewLink,shared,owners(displayName,emailAddress))'
    );
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');

    const driveRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await driveRes.json();
    if (!driveRes.ok) {
      const msg = data?.error?.message || 'ไม่สามารถดึงรายการไฟล์ Google Sheets จาก Google Drive ได้';
      res.status(driveRes.status).json({ error: msg });
      return;
    }

    res.json({ files: data.files || [] });
  } catch (error: unknown) {
    console.error('Error listing spreadsheets:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Google Drive API' });
  }
});

/**
 * GET /api/sheets/:spreadsheetId/metadata
 */
app.get('/api/sheets/:spreadsheetId/metadata', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    const { spreadsheetId } = req.params;

    if (token) {
      const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
      url.searchParams.set(
        'fields',
        'spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title,gridProperties)'
      );

      const sheetsRes = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (sheetsRes.ok) {
        const data = await sheetsRes.json();
        const sheets = (data.sheets || []).map((s: any) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? '',
          rowCount: s.properties?.gridProperties?.rowCount ?? 0,
          columnCount: s.properties?.gridProperties?.columnCount ?? 0,
        }));

        res.json({
          spreadsheetId: data.spreadsheetId,
          title: data.properties?.title || 'Untitled Spreadsheet',
          spreadsheetUrl: data.spreadsheetUrl,
          sheets,
        });
        return;
      }
    }

    // Fallback via gviz
    const fallbackMeta = await fetchSharedSheetViaGviz(spreadsheetId, token);
    res.json({
      spreadsheetId,
      title: fallbackMeta.title,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      sheets: fallbackMeta.sheetTitles.map((t, i) => ({ sheetId: i, title: t })),
    });
  } catch (error: any) {
    console.error('Error fetching spreadsheet metadata:', error);
    res.status(400).json({
      error: error?.message || 'เกิดข้อผิดพลาดในการอ่านข้อมูลโครงสร้างไฟล์ Google Sheets',
    });
  }
});

/**
 * POST /api/sheets/:spreadsheetId/batch-read
 * Reads configured category sheets via Google Sheets v4 API with automatic gviz fallback
 */
app.post('/api/sheets/:spreadsheetId/batch-read', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    const { spreadsheetId } = req.params;
    const categories: CategoryQueryInput[] = Array.isArray(req.body?.categories)
      ? req.body.categories
      : [
          { id: 'vip', name: 'VIP', sheetName: 'VIP' },
          { id: 'standard', name: 'Standard', sheetName: 'Standard' },
        ];

    // Path 1: Google Sheets REST API v4
    if (token) {
      const metaUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
      metaUrl.searchParams.set('fields', 'spreadsheetId,properties.title,spreadsheetUrl,sheets.properties(sheetId,title)');

      const metaRes = await fetch(metaUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (metaRes.ok) {
        const metaData = await metaRes.json();
        const availableSheetTitles: string[] = (metaData.sheets || []).map((s: any) =>
          String(s.properties?.title || '')
        );

        const usedFallbackSheets = new Set<string>();
        const resolvedCategories = categories.map((cat, idx) => {
          const desired = String(cat.sheetName || cat.name || '').trim();
          const exactMatch = availableSheetTitles.find((t) => t === desired);
          const caseInsensitiveMatch = availableSheetTitles.find(
            (t) => t.trim().toLowerCase() === desired.toLowerCase()
          );
          let actualSheetTitle = exactMatch || caseInsensitiveMatch || null;

          if (!actualSheetTitle && availableSheetTitles.length > 0) {
            const unused = availableSheetTitles.find((t) => !usedFallbackSheets.has(t));
            if (unused) {
              actualSheetTitle = unused;
            } else if (idx === 0) {
              actualSheetTitle = availableSheetTitles[0];
            }
          }

          if (actualSheetTitle) {
            usedFallbackSheets.add(actualSheetTitle);
          }

          return {
            ...cat,
            actualSheetTitle,
          };
        });

        const validCategories = resolvedCategories.filter((c) => c.actualSheetTitle !== null);

        if (validCategories.length > 0) {
          const formattedUrl = new URL(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`
          );
          formattedUrl.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
          for (const c of validCategories) {
            const escapedSheet = `'${c.actualSheetTitle!.replace(/'/g, "''")}'!A1:Z2000`;
            formattedUrl.searchParams.append('ranges', escapedSheet);
          }

          const formulaUrl = new URL(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet`
          );
          formulaUrl.searchParams.set('valueRenderOption', 'FORMULA');
          for (const c of validCategories) {
            const escapedSheet = `'${c.actualSheetTitle!.replace(/'/g, "''")}'!A1:Z2000`;
            formulaUrl.searchParams.append('ranges', escapedSheet);
          }

          const [formattedRes, formulaRes] = await Promise.all([
            fetch(formattedUrl.toString(), { headers: { Authorization: `Bearer ${token}` } }),
            fetch(formulaUrl.toString(), { headers: { Authorization: `Bearer ${token}` } }),
          ]);

          if (formattedRes.ok) {
            const formattedData = await formattedRes.json();
            const formulaData = formulaRes.ok ? await formulaRes.json() : null;
            const valueRanges: any[] = formattedData.valueRanges || [];
            const formulaRanges: any[] = formulaData?.valueRanges || [];

            let validIdx = 0;
            const categoryResults = resolvedCategories.map((cat) => {
              if (!cat.actualSheetTitle) {
                return {
                  categoryId: cat.id,
                  categoryName: cat.name,
                  sheetName: cat.sheetName,
                  foundSheet: false,
                  columnMap: null,
                  records: [],
                  error: `ไม่พบแผ่นงาน "${cat.sheetName}"`,
                };
              }

              const rangeObj = valueRanges[validIdx];
              const formulaRangeObj = formulaRanges[validIdx];
              validIdx++;

              const rows: string[][] = rangeObj?.values || [];
              const formulaRows: any[][] = formulaRangeObj?.values || [];

              return parseSheetRowsToRecords(rows, formulaRows, cat, cat.actualSheetTitle);
            });

            res.json({
              spreadsheetId: metaData.spreadsheetId,
              spreadsheetTitle: metaData.properties?.title || 'Spreadsheet',
              spreadsheetUrl: metaData.spreadsheetUrl,
              availableSheets: availableSheetTitles,
              categoryResults,
              fetchedAt: new Date().toISOString(),
            });
            return;
          }
        }
      }
    }

    // Path 2: Automatic fallback via Google Visualization (gviz/tq)
    const fallbackMeta = await fetchSharedSheetViaGviz(spreadsheetId, token);
    const availableSheetTitles = fallbackMeta.sheetTitles;
    const usedSheets = new Set<string>();

    const categoryResults = await Promise.all(
      categories.map(async (cat, idx) => {
        const desired = String(cat.sheetName || cat.name || '').trim();
        let actualSheetTitle =
          availableSheetTitles.find((t) => t === desired) ||
          availableSheetTitles.find((t) => t.trim().toLowerCase() === desired.toLowerCase()) ||
          null;

        if (!actualSheetTitle && availableSheetTitles.length > 0) {
          const unused = availableSheetTitles.find((t) => !usedSheets.has(t));
          if (unused) {
            actualSheetTitle = unused;
          } else if (idx === 0) {
            actualSheetTitle = availableSheetTitles[0];
          }
        }
        if (!actualSheetTitle) {
          actualSheetTitle = desired;
        }
        usedSheets.add(actualSheetTitle);

        try {
          const rows = await fetchSheetCsvViaGviz(spreadsheetId, actualSheetTitle, token);
          return parseSheetRowsToRecords(rows, [], cat, actualSheetTitle);
        } catch (err: any) {
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            sheetName: cat.sheetName,
            foundSheet: false,
            columnMap: null,
            records: [],
            error: err?.message || `ไม่สามารถอ่านแผ่นงาน "${cat.sheetName}" ได้`,
          };
        }
      })
    );

    res.json({
      spreadsheetId,
      spreadsheetTitle: fallbackMeta.title,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      availableSheets: availableSheetTitles,
      categoryResults,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in batch-read:', error);
    res.status(400).json({
      error: error?.message || 'ไม่สามารถอ่านข้อมูลจากไฟล์ Google Sheets ได้',
    });
  }
});

const CLOUD_STATE_FILENAME = 'Seat_Booking_System_CloudData.json';
const SERVER_DATA_DIR = path.join(__dirname, '.data');
const SERVER_CLOUD_STATE_PATH = path.join(SERVER_DATA_DIR, 'cloud_state_store.json');

function normalizeEmailKey(emailRaw?: unknown): string {
  const cleaned = String(emailRaw || 'ubcyber@gmail.com')
    .trim()
    .toLowerCase();
  return cleaned || 'ubcyber@gmail.com';
}

function readServerCloudState(emailRaw?: unknown): {
  state: any;
  modifiedTime: string;
  fileId: string;
} | null {
  try {
    if (!fs.existsSync(SERVER_CLOUD_STATE_PATH)) return null;
    const raw = fs.readFileSync(SERVER_CLOUD_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const key = normalizeEmailKey(emailRaw);
    const entry = parsed?.[key] || parsed?.['default'];
    if (entry && entry.state) {
      return {
        state: entry.state,
        modifiedTime: entry.modifiedTime || entry.state.updatedAt || new Date().toISOString(),
        fileId: entry.fileId || `cloud-${key}`,
      };
    }
  } catch (err) {
    console.warn('Warning reading local server cloud state:', err);
  }
  return null;
}

function writeServerCloudState(
  emailRaw: unknown,
  statePayload: any,
  fileId?: string | null
): { fileId: string; modifiedTime: string } {
  const nowIso = new Date().toISOString();
  const key = normalizeEmailKey(emailRaw);
  const resolvedFileId = fileId || `cloud-${key}`;
  try {
    if (!fs.existsSync(SERVER_DATA_DIR)) {
      fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
    }
    let store: Record<string, any> = {};
    if (fs.existsSync(SERVER_CLOUD_STATE_PATH)) {
      try {
        store = JSON.parse(fs.readFileSync(SERVER_CLOUD_STATE_PATH, 'utf-8')) || {};
      } catch {
        store = {};
      }
    }
    const entry = {
      fileId: resolvedFileId,
      modifiedTime: nowIso,
      state: {
        ...statePayload,
        updatedAt: nowIso,
      },
    };
    store[key] = entry;
    store['default'] = entry;
    fs.writeFileSync(SERVER_CLOUD_STATE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Warning writing local server cloud state:', err);
  }
  return { fileId: resolvedFileId, modifiedTime: nowIso };
}

async function findCloudStateFileInDrive(
  token: string
): Promise<{ id: string; name: string; modifiedTime?: string } | null> {
  const searchUrl = new URL('https://www.googleapis.com/drive/v3/files');
  searchUrl.searchParams.set(
    'q',
    `name = '${CLOUD_STATE_FILENAME}' and trashed = false`
  );
  searchUrl.searchParams.set('orderBy', 'modifiedTime desc');
  searchUrl.searchParams.set('pageSize', '5');
  searchUrl.searchParams.set('fields', 'files(id, name, modifiedTime)');

  const res = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return null;
  }
  const data = await res.json();
  const files = Array.isArray(data?.files) ? data.files : [];
  return files[0] || null;
}

/**
 * GET /api/drive/cloud-state
 * Loads the user's saved system state (categories, bookings, expenses) from Google Drive or persistent server store.
 */
app.get('/api/drive/cloud-state', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    const email = req.query.email || 'ubcyber@gmail.com';

    if (token) {
      try {
        const fileMeta = await findCloudStateFileInDrive(token);
        if (fileMeta) {
          const downloadRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileMeta.id)}?alt=media`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (downloadRes.ok) {
            const stateData = await downloadRes.json().catch(() => null);
            if (stateData) {
              writeServerCloudState(email, stateData, fileMeta.id);
              res.json({
                found: true,
                fileId: fileMeta.id,
                fileName: fileMeta.name,
                modifiedTime:
                  fileMeta.modifiedTime || stateData.updatedAt || new Date().toISOString(),
                state: stateData,
              });
              return;
            }
          }
        }
      } catch (driveErr) {
        console.warn('Drive GET fallback to server cloud store:', driveErr);
      }
    }

    const serverSaved = readServerCloudState(email);
    if (serverSaved) {
      res.json({
        found: true,
        fileId: serverSaved.fileId,
        fileName: CLOUD_STATE_FILENAME,
        modifiedTime: serverSaved.modifiedTime,
        state: serverSaved.state,
      });
      return;
    }

    res.json({ found: false });
  } catch (error: any) {
    console.error('Error in GET /api/drive/cloud-state:', error);
    res.json({ found: false });
  }
});

/**
 * POST /api/drive/cloud-state
 * Saves the user's entire system state (categories, bookings, expenses) into persistent server store and Google Drive.
 */
app.post('/api/drive/cloud-state', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    const email = req.body?.email || req.query.email || 'ubcyber@gmail.com';
    const statePayload = req.body?.state;
    if (!statePayload || typeof statePayload !== 'object') {
      res.status(400).json({ error: 'ไม่พบข้อมูลที่ต้องการบันทึก' });
      return;
    }

    // 1. Always persist to server cloud store immediately so data is never lost
    const localSaved = writeServerCloudState(email, statePayload, req.body?.fileId);

    // 2. If a Google OAuth token is active, also sync to Google Drive
    if (token) {
      try {
        let targetFileId: string | null =
          req.body?.fileId && !String(req.body.fileId).startsWith('cloud-')
            ? req.body.fileId
            : null;
        if (!targetFileId) {
          const existing = await findCloudStateFileInDrive(token);
          if (existing) {
            targetFileId = existing.id;
          }
        }

        const boundary = `-------SeatBookingCloudSyncBoundary${Date.now()}`;
        const metadata = {
          name: CLOUD_STATE_FILENAME,
          mimeType: 'application/json',
          description: 'VIP & Standard Seat Booking & Back-Office Expense System Cloud Database',
        };

        const jsonString = JSON.stringify(
          {
            ...statePayload,
            updatedAt: localSaved.modifiedTime,
          },
          null,
          2
        );

        const multipartBody = [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          jsonString,
          `--${boundary}--`,
          '',
        ].join('\r\n');

        let uploadRes: globalThis.Response | null = null;
        if (targetFileId) {
          uploadRes = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
              targetFileId
            )}?uploadType=multipart&fields=id,name,modifiedTime`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
              },
              body: multipartBody,
            }
          );

          if (uploadRes.status === 404) {
            targetFileId = null;
          }
        }

        if (!targetFileId) {
          uploadRes = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
              },
              body: multipartBody,
            }
          );
        }

        if (uploadRes && uploadRes.ok) {
          const uploadData = await uploadRes.json().catch(() => ({}));
          writeServerCloudState(email, statePayload, uploadData.id);
          res.json({
            saved: true,
            fileId: uploadData.id || localSaved.fileId,
            fileName: uploadData.name || CLOUD_STATE_FILENAME,
            modifiedTime: uploadData.modifiedTime || localSaved.modifiedTime,
          });
          return;
        }
      } catch (driveErr) {
        console.warn('Drive POST fallback to server cloud store:', driveErr);
      }
    }

    res.json({
      saved: true,
      fileId: localSaved.fileId,
      fileName: CLOUD_STATE_FILENAME,
      modifiedTime: localSaved.modifiedTime,
    });
  } catch (error: any) {
    console.error('Error in POST /api/drive/cloud-state:', error);
    res.status(500).json({
      error: error?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล',
    });
  }
});

/**
 * POST /api/drive/sync-google-sheet
 * Creates or updates a real Google Spreadsheet in the user's Google Drive containing all zone bookings and expenses.
 */
app.post('/api/drive/sync-google-sheet', async (req: Request, res: Response) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วย Google เพื่อบันทึกเป็น Google Sheets' });
      return;
    }

    const categories: any[] = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const categoryResults: any[] = Array.isArray(req.body?.categoryResults)
      ? req.body.categoryResults
      : [];
    const expenses: any[] = Array.isArray(req.body?.expenses) ? req.body.expenses : [];
    const desiredTitle =
      String(req.body?.title || '').trim() || 'ระบบจองโต๊ะ VIP & Standard และรายจ่าย';

    // Build sheet definitions for Google Sheets v4 create API
    const usedTitles = new Set<string>();
    const sheetsPayload: any[] = [];

    for (const cat of categories) {
      let sheetTitle = String(cat.sheetName || cat.name || 'Sheet')
        .replace(/[\\/?*[\]:]/g, '')
        .trim()
        .slice(0, 31);
      if (!sheetTitle) sheetTitle = 'Sheet';
      let finalTitle = sheetTitle;
      let idx = 2;
      while (usedTitles.has(finalTitle.toLowerCase())) {
        finalTitle = `${sheetTitle.slice(0, 27)}_${idx}`;
        idx++;
      }
      usedTitles.add(finalTitle.toLowerCase());

      const catRes = categoryResults.find((r) => r.categoryId === cat.id);
      const records: any[] = Array.isArray(catRes?.records) ? catRes.records : [];

      const values: any[][] = [
        [
          'เลขโต๊ะ',
          'ชื่อ-นามสกุล',
          'เบอร์โทร',
          'ยอดโอน',
          'วันที่โอน',
          'ลิ้งค์สลีป',
          'โอนแล้ว',
          'เช็คอินแล้ว',
          'เวลาเช็คอิน',
          'รับบัตรแล้ว',
          'เวลารับบัตร',
          'หมายเหตุ',
          'ลิ้งค์สลีป 2',
        ],
        ...records.map((r) => [
          r.tableNumber || '',
          r.fullName || '',
          r.phone || '',
          r.transferAmount > 0 ? r.transferAmount : r.rawTransferAmount || '',
          r.transferDate || '',
          r.slipUrl && !String(r.slipUrl).startsWith('data:') ? r.slipUrl : '',
          r.isPaid ? 'TRUE' : 'FALSE',
          r.isCheckedIn ? 'TRUE' : 'FALSE',
          r.checkedInAt || '',
          r.isTicketCollected ? 'TRUE' : 'FALSE',
          r.ticketCollectedAt || '',
          r.note || '',
          r.slipUrl2 && !String(r.slipUrl2).startsWith('data:') ? r.slipUrl2 : '',
        ]),
      ];

      sheetsPayload.push({
        title: finalTitle,
        values,
      });
    }

    // Add Expenses sheet
    sheetsPayload.push({
      title: 'รายจ่าย',
      values: [
        ['วันที่จ่าย', 'รายการค่าใช้จ่าย', 'หมวดหมู่', 'จำนวนเงิน', 'ผู้เบิก/หมายเหตุ', 'ลิงก์ใบเสร็จ'],
        ...expenses.map((e) => [
          e.expenseDate || '',
          e.title || '',
          e.categoryLabel || '',
          e.amount || 0,
          e.payeeOrNote || '',
          e.receiptUrl && !String(e.receiptUrl).startsWith('data:') ? e.receiptUrl : '',
        ]),
      ],
    });

    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: desiredTitle },
        sheets: sheetsPayload.map((s) => ({
          properties: { title: s.title },
        })),
      }),
    });

    const createdData = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      res.status(createRes.status).json({
        error:
          createdData?.error?.message ||
          'ไม่สามารถสร้างไฟล์ Google Sheets ใน Google Drive ได้ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
      });
      return;
    }

    const newSpreadsheetId = createdData.spreadsheetId;

    // Populate all sheet values via values:batchUpdate
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        newSpreadsheetId
      )}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: sheetsPayload.map((s) => ({
            range: `'${s.title.replace(/'/g, "''")}'!A1`,
            values: s.values,
          })),
        }),
      }
    );

    res.json({
      spreadsheetId: newSpreadsheetId,
      spreadsheetUrl:
        createdData.spreadsheetUrl ||
        `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}/edit`,
      title: desiredTitle,
    });
  } catch (error: any) {
    console.error('Error in POST /api/drive/sync-google-sheet:', error);
    res.status(500).json({
      error: error?.message || 'เกิดข้อผิดพลาดในการสร้างไฟล์ Google Sheets ใน Drive',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

