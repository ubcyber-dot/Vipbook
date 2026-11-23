import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Download,
  Upload,
  Copy,
  Check,
  AlertCircle,
  Layers,
  Play,
} from 'lucide-react';
import { CategoryConfig, ExpenseRecord } from '../types/booking';
import { TemplateSheetPayload } from '../services/sheetsApi';
import {
  downloadExcelTemplate,
  ParsedExcelWorkbook,
  parseExcelWorkbookFile,
  parseExpensesFromWorkbook,
  STANDARD_TEMPLATE_HEADERS,
} from '../utils/excelTemplate';

interface ExcelTemplateImporterProps {
  categories: CategoryConfig[];
  onImportSheets: (
    updatedCategories: CategoryConfig[],
    sheets: TemplateSheetPayload[],
    title: string,
    availableSheets: string[],
    importedExpenses?: ExpenseRecord[]
  ) => Promise<void>;
  onLoadDefaultTemplate: () => void;
  isSubmitting?: boolean;
}

const HEADER_COLUMNS = [
  { col: 'A', name: 'เลขโต๊ะ' },
  { col: 'B', name: 'ชื่อ-นามสกุล' },
  { col: 'C', name: 'เบอร์โทร' },
  { col: 'D', name: 'ยอดโอน' },
  { col: 'E', name: 'วันที่โอน' },
  { col: 'F', name: 'ลิ้งค์สลีป' },
  { col: 'G', name: 'โอนแล้ว' },
];

/**
 * Smartly matches categories (e.g. VIP, Standard) to sheet names in an uploaded Excel workbook.
 * Even if the sheets are named e.g. "Sheet1", "Sheet2" instead of "VIP", "Standard",
 * it automatically assigns positional fallbacks so importing never fails!
 */
function isReservedNonZoneSheet(sheetName: string): boolean {
  const n = sheetName.trim().toLowerCase();
  return (
    n.includes('รายจ่าย') ||
    n.includes('ค่าใช้จ่าย') ||
    n.includes('สรุปงบ') ||
    n.includes('expense')
  );
}

function computeSmartSheetMapping(
  categories: CategoryConfig[],
  sheetNames: string[]
): Record<string, string> {
  const autoMap: Record<string, string> = {};
  const usedSheets = new Set<string>();
  const candidateSheets = sheetNames.filter((s) => !isReservedNonZoneSheet(s));
  const pool = candidateSheets.length > 0 ? candidateSheets : sheetNames;

  // Pass 1: Exact or partial name match
  for (const cat of categories) {
    const desired = (cat.sheetName || cat.name).trim().toLowerCase();
    const exact = pool.find((s) => s.trim().toLowerCase() === desired);
    const partial = pool.find(
      (s) =>
        s.trim().toLowerCase().includes(desired) ||
        desired.includes(s.trim().toLowerCase())
    );
    const matched = exact || partial;
    if (matched) {
      autoMap[cat.id] = matched;
      usedSheets.add(matched);
    }
  }

  // Pass 2: Positional fallback for any category whose name didn't match a tab name
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    if (autoMap[cat.id]) continue;

    // Pick first unused sheet, or if only 1 sheet exists in the workbook, assign it to the first category
    const unusedSheet = pool.find((s) => !usedSheets.has(s));
    if (unusedSheet) {
      autoMap[cat.id] = unusedSheet;
      usedSheets.add(unusedSheet);
    } else if (i === 0 && pool.length > 0) {
      autoMap[cat.id] = pool[0];
    } else {
      autoMap[cat.id] = '';
    }
  }

  return autoMap;
}

export const ExcelTemplateImporter: React.FC<ExcelTemplateImporterProps> = ({
  categories,
  onImportSheets,
  onLoadDefaultTemplate,
  isSubmitting = false,
}) => {
  const [workbook, setWorkbook] = useState<ParsedExcelWorkbook | null>(null);
  const [sheetSelectionMap, setSheetSelectionMap] = useState<Record<string, string>>({});
  const [perCategoryFiles, setPerCategoryFiles] = useState<
    Record<
      string,
      {
        fileName: string;
        sheetName: string;
        rows: string[][];
        formulaRows: string[][];
        dataRowCount: number;
      }
    >
  >({});
  const [showSeparateUpload, setShowSeparateUpload] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [copiedHeader, setCopiedHeader] = useState(false);

  const handleCopyHeaders = async () => {
    const tsvHeaders = STANDARD_TEMPLATE_HEADERS.join('\t');
    try {
      await navigator.clipboard.writeText(tsvHeaders);
      setCopiedHeader(true);
      setTimeout(() => setCopiedHeader(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const buildPayloadsAndImport = async (
    targetWorkbook: ParsedExcelWorkbook | null,
    targetMap: Record<string, string>,
    targetPerCategory: typeof perCategoryFiles
  ) => {
    const payloads: TemplateSheetPayload[] = [];
    const updatedCategories = categories.map((cat) => {
      if (targetPerCategory[cat.id]) {
        const sep = targetPerCategory[cat.id];
        payloads.push({
          categoryId: cat.id,
          categoryName: cat.name,
          sheetName: sep.sheetName,
          rows: sep.rows,
          formulaRows: sep.formulaRows,
          fileName: sep.fileName,
        });
        return { ...cat, sheetName: sep.sheetName };
      }

      if (targetWorkbook) {
        const chosenTab = targetMap[cat.id];
        if (chosenTab && targetWorkbook.sheets[chosenTab]) {
          const sheetData = targetWorkbook.sheets[chosenTab];
          payloads.push({
            categoryId: cat.id,
            categoryName: cat.name,
            sheetName: chosenTab,
            rows: sheetData.rows,
            formulaRows: sheetData.formulaRows,
            fileName: targetWorkbook.fileName,
          });
          return { ...cat, sheetName: chosenTab };
        }
      }

      return cat;
    });

    if (payloads.length === 0) {
      setParseError('กรุณาเลือกแผ่นงานในไฟล์ Excel อย่างน้อย 1 แผ่นงาน');
      return;
    }

    const title = targetWorkbook
      ? `ไฟล์ Excel: ${targetWorkbook.fileName}`
      : 'นำเข้าจากแม่แบบ Excel (VIP & Standard)';
    const availableSheets = targetWorkbook
      ? targetWorkbook.sheetNames
      : updatedCategories.map((c) => c.sheetName);

    const importedExpenses = targetWorkbook
      ? parseExpensesFromWorkbook(targetWorkbook)
      : undefined;

    await onImportSheets(
      updatedCategories,
      payloads,
      title,
      availableSheets,
      importedExpenses
    );
  };

  const handleWorkbookUpload = async (file: File | null) => {
    if (!file) return;
    setParseError(null);
    try {
      const parsed = await parseExcelWorkbookFile(file);
      if (parsed.sheetNames.length === 0) {
        throw new Error('ไม่พบแผ่นงานในไฟล์ที่อัปโหลด');
      }
      setWorkbook(parsed);
      const autoMap = computeSmartSheetMapping(categories, parsed.sheetNames);
      setSheetSelectionMap(autoMap);

      // Immediately import if sheets matched cleanly so the user doesn't have to click twice!
      await buildPayloadsAndImport(parsed, autoMap, perCategoryFiles);
    } catch (err: any) {
      console.error('Failed to parse Excel workbook:', err);
      setParseError(
        err?.message || 'ไม่สามารถอ่านไฟล์ Excel ได้ กรุณาตรวจสอบว่าเป็นไฟล์ .xlsx, .xls หรือ .csv ที่ถูกต้อง'
      );
    }
  };

  const handleSeparateCategoryFileUpload = async (
    category: CategoryConfig,
    file: File | null
  ) => {
    if (!file) return;
    setParseError(null);
    try {
      const parsed = await parseExcelWorkbookFile(file);
      const desired = (category.sheetName || category.name).trim().toLowerCase();
      const matchedTab =
        parsed.sheetNames.find((s) => s.trim().toLowerCase() === desired) ||
        parsed.sheetNames[0];

      if (!matchedTab || !parsed.sheets[matchedTab]) {
        throw new Error(`ไม่พบแผ่นงานข้อมูลในไฟล์ ${file.name}`);
      }

      const sheetData = parsed.sheets[matchedTab];
      setPerCategoryFiles((prev) => ({
        ...prev,
        [category.id]: {
          fileName: file.name,
          sheetName: matchedTab,
          rows: sheetData.rows,
          formulaRows: sheetData.formulaRows,
          dataRowCount: sheetData.dataRowCount,
        },
      }));
    } catch (err: any) {
      setParseError(err?.message || `ไม่สามารถอ่านไฟล์ ${file.name} ได้`);
    }
  };

  const canSubmit =
    Boolean(workbook && Object.values(sheetSelectionMap).some(Boolean)) ||
    Object.keys(perCategoryFiles).length > 0;

  return (
    <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-5">
      {/* Top Row: Title + Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            นำเข้าแม่แบบ Excel (.xlsx / .xls / .csv)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            อัปโหลดไฟล์ Excel ของคุณเพื่อใช้งานทันที หรือดาวน์โหลดไฟล์แม่แบบ Excel มาตรฐาน (VIP & Standard)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyHeaders}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            {copiedHeader ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                คัดลอกหัวตารางแล้ว
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                คัดลอกหัวตาราง (A–G)
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => downloadExcelTemplate(categories)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            ดาวน์โหลดแม่แบบ Excel (.xlsx)
          </button>

          <button
            type="button"
            onClick={onLoadDefaultTemplate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            เปิดตารางแม่แบบเริ่มต้นทันที
          </button>
        </div>
      </div>

      {/* 7-Column Standard Header Structure Reference */}
      <div className="grid grid-cols-2 sm:grid-cols-7 gap-1.5 text-center">
        {HEADER_COLUMNS.map((h) => (
          <div
            key={h.col}
            className="bg-white border border-slate-200 rounded-lg p-2 space-y-0.5"
          >
            <span className="block text-[10px] font-mono font-bold text-slate-400">
              คอลัมน์ {h.col}
            </span>
            <span className="block text-xs font-bold text-slate-800 truncate">
              {h.name}
            </span>
          </div>
        ))}
      </div>

      {/* Primary Upload Dropzone: Single Excel (.xlsx / .xls) Workbook */}
      <div className="space-y-3">
        <label className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 bg-white border-2 border-dashed border-slate-300 hover:border-slate-900 rounded-xl cursor-pointer transition-colors">
          <div className="flex items-center gap-3.5 text-center sm:text-left">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 mx-auto sm:mx-0">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {workbook
                  ? `นำเข้าไฟล์แล้ว: ${workbook.fileName}`
                  : 'คลิกเพื่อเลือกไฟล์แม่แบบ Excel (.xlsx, .xls, .csv) จากเครื่องของคุณ'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {workbook
                  ? `พบ ${workbook.sheetNames.length} แผ่นงาน (${workbook.sheetNames.join(', ')}) — สามารถปรับการจับคู่แผ่นงานด้านล่างได้`
                  : 'เมื่อเลือกไฟล์ ระบบจะอ่านหัวตารางและนำเข้าข้อมูลแผ่นงาน VIP และ Standard โดยอัตโนมัติทันที'}
              </p>
            </div>
          </div>

          <span className="px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0">
            {workbook ? 'เลือกไฟล์ Excel ใหม่' : 'อัปโหลดไฟล์ Excel (.xlsx)'}
          </span>

          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            className="hidden"
            onChange={(e) => {
              handleWorkbookUpload(e.target.files?.[0] || null);
              e.target.value = '';
            }}
          />
        </label>

        {/* Sheet-to-Category Mapping Preview when an Excel Workbook is loaded */}
        {workbook && (
          <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-slate-500" />
                ตรวจสอบการจับคู่แผ่นงานในไฟล์ Excel ({categories.map((c) => c.name).join(' / ')})
              </span>
              <span className="text-[11px] text-emerald-700 font-medium">
                สามารถเปลี่ยนแผ่นงานแล้วกดปุ่มยืนยันด้านล่างได้
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {categories.map((cat) => {
                const selectedSheet = sheetSelectionMap[cat.id] || '';
                const sheetInfo = selectedSheet ? workbook.sheets[selectedSheet] : null;
                return (
                  <div
                    key={cat.id}
                    className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cat.colorHex }}
                        />
                        <span className="text-xs font-bold text-slate-900">
                          ประเภท {cat.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        {sheetInfo
                          ? `พบข้อมูล ${sheetInfo.dataRowCount} แถว`
                          : 'ไม่ได้เลือกแผ่นงาน'}
                      </p>
                    </div>

                    <select
                      value={selectedSheet}
                      onChange={(e) =>
                        setSheetSelectionMap((prev) => ({
                          ...prev,
                          [cat.id]: e.target.value,
                        }))
                      }
                      className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
                    >
                      <option value="">-- ไม่นำเข้า --</option>
                      {workbook.sheetNames.map((tabName) => (
                        <option key={tabName} value={tabName}>
                          แผ่นงาน: {tabName} ({workbook.sheets[tabName]?.dataRowCount ?? 0} โต๊ะ)
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Optional: Separate File Upload per Category */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowSeparateUpload((prev) => !prev)}
          className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
        >
          {showSeparateUpload
            ? 'ซ่อนตัวเลือกอัปโหลดแยกไฟล์ตามประเภท'
            : 'กรณีแยกไฟล์ Excel คนละไฟล์สำหรับ VIP และ Standard คลิกที่นี่'}
        </button>

        {showSeparateUpload && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {categories.map((cat) => {
              const sep = perCategoryFiles[cat.id];
              return (
                <label
                  key={cat.id}
                  className="flex items-center justify-between gap-3 p-3.5 bg-white border border-slate-300 hover:border-slate-900 rounded-xl cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.colorHex }}
                      />
                      <span className="text-xs font-bold text-slate-900">
                        ไฟล์ Excel เฉพาะประเภท {cat.name}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {sep
                        ? `${sep.fileName} (${sep.dataRowCount} แถว)`
                        : `เลือกไฟล์ .xlsx / .xls สำหรับ ${cat.name}`}
                    </p>
                  </div>
                  <span className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg shrink-0">
                    เลือกไฟล์
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.tsv"
                    className="hidden"
                    onChange={(e) => {
                      handleSeparateCategoryFileUpload(cat, e.target.files?.[0] || null);
                      e.target.value = '';
                    }}
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>

      {parseError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs font-medium text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {/* Submit Button when workbook or separate files are staged */}
      {canSubmit && (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() =>
              buildPayloadsAndImport(workbook, sheetSelectionMap, perCategoryFiles)
            }
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-xl transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            {isSubmitting ? 'กำลังประมวลผลข้อมูล...' : 'ยืนยันนำเข้าข้อมูลจากแม่แบบ Excel'}
          </button>
        </div>
      )}
    </div>
  );
};
