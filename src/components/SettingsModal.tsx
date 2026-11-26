import React, { useState, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  Search,
  Palette,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  RefreshCw,
  Table,
  Share2,
  FolderOpen,
} from 'lucide-react';
import {
  CategoryConfig,
  CategorySheetResult,
  DriveFilterMode,
  ExpenseRecord,
  SpreadsheetFileItem,
} from '../types/booking';
import {
  fetchSpreadsheetMetadata,
  listDriveSpreadsheets,
  TemplateSheetPayload,
} from '../services/sheetsApi';
import { normalizeHexColor } from '../utils/excelTemplate';
import { ExcelTemplateImporter } from './ExcelTemplateImporter';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  spreadsheetId: string;
  spreadsheetTitle: string;
  availableSheets: string[];
  categories: CategoryConfig[];
  categoryResults: CategorySheetResult[];
  onSaveConfig: (newSpreadsheetId: string, newCategories: CategoryConfig[]) => void;
  onImportTemplateFiles: (
    newCategories: CategoryConfig[],
    sheets: TemplateSheetPayload[],
    title?: string,
    availableSheets?: string[],
    importedExpenses?: ExpenseRecord[]
  ) => Promise<void>;
  onLoadDefaultTemplate: () => void;
  onResetColors: () => void;
  isAuthenticated: boolean;
  onRequestGoogleLogin: () => void;
}

const PRESET_COLORS = [
  { label: 'VIP Gold (ค่าเริ่มต้น VIP)', hex: '#D97706' },
  { label: 'Royal Gold', hex: '#B45309' },
  { label: 'Standard Blue (ค่าเริ่มต้น Standard)', hex: '#2563EB' },
  { label: 'Navy Blue', hex: '#1D4ED8' },
  { label: 'Indigo', hex: '#4F46E5' },
  { label: 'Violet', hex: '#7C3AED' },
  { label: 'Cyan', hex: '#0891B2' },
  { label: 'Slate', hex: '#334155' },
];

function indexToColumnLetter(idx: number): string {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  spreadsheetId,
  spreadsheetTitle,
  availableSheets,
  categories,
  categoryResults,
  onSaveConfig,
  onImportTemplateFiles,
  onLoadDefaultTemplate,
  onResetColors,
  isAuthenticated,
  onRequestGoogleLogin,
}) => {
  const [selectedDriveId, setSelectedDriveId] = useState(
    spreadsheetId === 'template-import' ? '' : spreadsheetId
  );
  const [localCategories, setLocalCategories] = useState<CategoryConfig[]>(categories);
  const [detectedSheets, setDetectedSheets] = useState<string[]>(availableSheets);
  const [detectedTitle, setDetectedTitle] = useState<string>(spreadsheetTitle);
  const [isImportingTemplate, setIsImportingTemplate] = useState(false);

  // Drive Shared / All Files State
  const [driveFilter, setDriveFilter] = useState<DriveFilterMode>('sharedWithMe');
  const [driveFiles, setDriveFiles] = useState<SpreadsheetFileItem[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  // New Category Form
  const [newCatName, setNewCatName] = useState('');
  const [newCatSheet, setNewCatSheet] = useState('');
  const [newCatColor, setNewCatColor] = useState('#7C3AED');

  useEffect(() => {
    if (!isOpen) return;
    setSelectedDriveId(spreadsheetId === 'template-import' ? '' : spreadsheetId);
    setLocalCategories(categories);
    setDetectedSheets(availableSheets);
    setDetectedTitle(spreadsheetTitle);
  }, [isOpen, spreadsheetId, categories, availableSheets, spreadsheetTitle]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadDriveFiles = async (query = '', mode: DriveFilterMode = driveFilter) => {
    if (!isAuthenticated) return;
    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const files = await listDriveSpreadsheets(query, mode);
      setDriveFiles(files);
    } catch (err: any) {
      setDriveError(err.message || 'ไม่สามารถดึงรายการไฟล์จาก Google Drive ได้');
    } finally {
      setIsLoadingDrive(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      loadDriveFiles(driveSearch, driveFilter);
    }
  }, [isOpen, isAuthenticated, driveFilter]);

  if (!isOpen) return null;

  const handleSelectDriveSpreadsheet = async (file: SpreadsheetFileItem) => {
    setSelectedDriveId(file.id);
    setDetectedTitle(file.name);
    try {
      const meta = await fetchSpreadsheetMetadata(file.id);
      setDetectedTitle(meta.title);
      const tabNames = meta.sheets.map((s) => s.title).filter(Boolean);
      setDetectedSheets(tabNames);
    } catch (err) {
      console.error('Error fetching metadata for selected file:', err);
    }
  };

  const handleCategoryChange = (
    id: string,
    field: keyof CategoryConfig,
    value: string
  ) => {
    setLocalCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const handleAddCategory = () => {
    const trimmedName = newCatName.trim();
    const trimmedSheet = (newCatSheet || trimmedName).trim();
    if (!trimmedName) return;

    const id = `cat-${Date.now()}`;
    setLocalCategories((prev) => [
      ...prev,
      {
        id,
        name: trimmedName,
        sheetName: trimmedSheet,
        colorHex: newCatColor,
        isDefault: false,
      },
    ]);
    setNewCatName('');
    setNewCatSheet('');
  };

  const handleRemoveCategory = (id: string) => {
    setLocalCategories((prev) => prev.filter((c) => c.id !== id));
  };

  const handleApplyAndSave = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = localCategories.map((cat) => {
      const fallbackColor =
        cat.id === 'vip' || cat.name.toLowerCase().includes('vip')
          ? '#D97706'
          : '#2563EB';
      return {
        ...cat,
        name: cat.name.trim() || cat.id,
        sheetName: cat.sheetName.trim() || cat.name.trim() || cat.id,
        colorHex: normalizeHexColor(cat.colorHex, fallbackColor),
      };
    });
    onSaveConfig(selectedDriveId || spreadsheetId, sanitized);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden my-8 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              นำเข้าแม่แบบ Excel (.xlsx) & ตั้งค่าสีประจำประเภทโต๊ะ
            </h2>
            <p className="text-xs text-slate-500">
              ดาวน์โหลดหรืออัปโหลดไฟล์แม่แบบ Excel (VIP / Standard) หรือเลือกไฟล์จาก Google Drive พร้อมปรับแต่งสีประจำประเภท
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 space-y-8 overflow-y-auto flex-1">
          {/* Section 1: Import from Excel Template (.xlsx / .xls) */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                1. นำเข้าจากไฟล์แม่แบบ Excel มาตรฐาน (VIP & Standard)
              </h3>
              {detectedTitle && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
                  ข้อมูลปัจจุบัน: {detectedTitle}
                </span>
              )}
            </div>

            <ExcelTemplateImporter
              categories={localCategories}
              isSubmitting={isImportingTemplate}
              onLoadDefaultTemplate={() => {
                onLoadDefaultTemplate();
                onClose();
              }}
              onImportSheets={async (
                updatedCats,
                sheets,
                title,
                availSheets,
                importedExpenses
              ) => {
                setIsImportingTemplate(true);
                try {
                  setLocalCategories(updatedCats);
                  await onImportTemplateFiles(
                    updatedCats,
                    sheets,
                    title,
                    availSheets,
                    importedExpenses
                  );
                  onClose();
                } finally {
                  setIsImportingTemplate(false);
                }
              }}
            />

            {/* Option B: Pick from Google Drive ("Shared with me" / "All") */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">
                    หรือเลือกไฟล์จาก Google Drive:
                  </span>
                  {isAuthenticated && (
                    <div className="flex items-center gap-1 p-0.5 bg-slate-200/80 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setDriveFilter('sharedWithMe')}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          driveFilter === 'sharedWithMe'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Share2 className="w-3 h-3" />
                        แชร์กับฉัน (Shared with me)
                      </button>
                      <button
                        type="button"
                        onClick={() => setDriveFilter('all')}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          driveFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <FolderOpen className="w-3 h-3" />
                        ไฟล์ทั้งหมด
                      </button>
                    </div>
                  )}
                </div>

                {isAuthenticated && (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={driveSearch}
                        onChange={(e) => setDriveSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            loadDriveFiles(driveSearch, driveFilter);
                          }
                        }}
                        placeholder="ค้นหาชื่อไฟล์..."
                        className="pl-8 pr-3 py-1 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => loadDriveFiles(driveSearch, driveFilter)}
                      disabled={isLoadingDrive}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingDrive ? 'animate-spin' : ''}`} />
                      ค้นหา
                    </button>
                  </div>
                )}
              </div>

              {!isAuthenticated ? (
                <div className="py-4 px-4 bg-white border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-600">
                    เข้าสู่ระบบด้วย Google เพื่อเลือกไฟล์ Google Sheets จากหมวด &ldquo;แชร์กับฉัน&rdquo; หรือใน Google Drive ของคุณ
                  </p>
                  <button
                    type="button"
                    onClick={onRequestGoogleLogin}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                  >
                    เข้าสู่ระบบด้วย Google
                  </button>
                </div>
              ) : (
                <>
                  {driveError && <p className="text-xs text-red-600">{driveError}</p>}

                  {isLoadingDrive ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      กำลังโหลดรายการไฟล์ Google Sheets จาก Google Drive...
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div className="py-5 text-center text-xs text-slate-500 space-y-2">
                      <p>
                        {driveFilter === 'sharedWithMe'
                          ? 'ไม่พบไฟล์ Google Sheets ในหมวด "แชร์กับฉัน"'
                          : 'ไม่พบไฟล์ Google Sheets ที่ตรงกับคำค้นหา'}
                      </p>
                      {driveFilter === 'sharedWithMe' && (
                        <button
                          type="button"
                          onClick={() => setDriveFilter('all')}
                          className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                        >
                          สลับไปดูไฟล์ทั้งหมดใน Google Drive
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {driveFiles.map((file) => {
                        const isCurrent = selectedDriveId === file.id;
                        const ownerName =
                          file.owners?.[0]?.displayName || file.owners?.[0]?.emailAddress || '';
                        return (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => handleSelectDriveSpreadsheet(file)}
                            className={`text-left p-2.5 rounded-lg border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                              isCurrent
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-800 border-slate-200 hover:border-slate-400'
                            }`}
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="text-xs font-semibold truncate">{file.name}</p>
                              <p
                                className={`text-[10px] truncate ${
                                  isCurrent ? 'text-slate-300' : 'text-slate-400'
                                }`}
                              >
                                {ownerName ? `แชร์โดย: ${ownerName}` : 'Google Sheets'}
                                {file.modifiedTime &&
                                  ` · ${new Date(file.modifiedTime).toLocaleDateString('th-TH')}`}
                              </p>
                            </div>
                            {isCurrent ? (
                              <Check className="w-4 h-4 shrink-0" />
                            ) : (
                              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Section 2: Category Color & Sheet Tab Mapping */}
          <section className="space-y-4 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-amber-600" />
                  2. ระบบแบ่งประเภทโต๊ะ ปรับแต่งสี และจับคู่แผ่นงาน (VIP / Standard)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  สีประจำประเภทจะถูกนำไปใช้เหมือนกันในหน้าค้นหา, Dashboard และผังโต๊ะ (แยกจากสีสถานะชำระเงินเขียว/แดงอย่างชัดเจน)
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setLocalCategories((prev) =>
                    prev.map((c) => {
                      if (c.id === 'vip') return { ...c, colorHex: '#D97706' };
                      if (c.id === 'standard') return { ...c, colorHex: '#2563EB' };
                      return c;
                    })
                  );
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                คืนค่าสีเริ่มต้น (ทอง / น้ำเงิน)
              </button>
            </div>

            <div className="space-y-3">
              {localCategories.map((cat) => (
                <div
                  key={cat.id}
                  className="p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-4 items-center"
                >
                  {/* Category Name */}
                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      ชื่อประเภทโต๊ะ
                    </label>
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) => handleCategoryChange(cat.id, 'name', e.target.value)}
                      className="w-full px-3 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                    />
                  </div>

                  {/* Sheet Name */}
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      ชื่อแผ่นงาน (Sheet Tab)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={cat.sheetName}
                        onChange={(e) =>
                          handleCategoryChange(cat.id, 'sheetName', e.target.value)
                        }
                        placeholder="เช่น VIP หรือ Standard"
                        className="w-full px-3 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                      />
                      {detectedSheets.length > 0 && (
                        <select
                          value={
                            detectedSheets.includes(cat.sheetName) ? cat.sheetName : ''
                          }
                          onChange={(e) => {
                            if (e.target.value) {
                              handleCategoryChange(cat.id, 'sheetName', e.target.value);
                            }
                          }}
                          className="px-2 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-700"
                        >
                          <option value="">เลือกแผ่นงาน...</option>
                          {detectedSheets.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Color Picker */}
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      สีประจำประเภท (Color Picker)
                    </label>
                    <div className="flex items-center gap-2.5">
                      <input
                        type="color"
                        value={normalizeHexColor(cat.colorHex, '#2563EB')}
                        onChange={(e) =>
                          handleCategoryChange(cat.id, 'colorHex', e.target.value.toUpperCase())
                        }
                        className="w-10 h-10 rounded-lg border border-slate-300 cursor-pointer p-0.5 bg-white shrink-0"
                      />
                      <input
                        type="text"
                        value={cat.colorHex}
                        onChange={(e) =>
                          handleCategoryChange(cat.id, 'colorHex', e.target.value)
                        }
                        onBlur={(e) =>
                          handleCategoryChange(
                            cat.id,
                            'colorHex',
                            normalizeHexColor(e.target.value, '#2563EB')
                          )
                        }
                        className="w-24 px-2.5 py-2 text-xs font-mono uppercase bg-white border border-slate-300 rounded-lg"
                      />
                      <span
                        className="px-2.5 py-1.5 rounded-md text-xs font-bold text-white whitespace-nowrap shrink-0"
                        style={{ backgroundColor: normalizeHexColor(cat.colorHex, '#2563EB') }}
                      >
                        ตัวอย่าง {cat.name}
                      </span>
                    </div>
                  </div>

                  {/* Delete Custom Category */}
                  <div className="md:col-span-1 flex justify-end">
                    {!cat.isDefault && localCategories.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCategory(cat.id)}
                        title="ลบประเภทนี้"
                        className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Preset Color Swatches Helper */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500">สีแนะนำ:</span>
              {PRESET_COLORS.map((preset) => (
                <span
                  key={preset.hex}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded-md"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: preset.hex }}
                  />
                  <span>{preset.label}</span>
                  <span className="font-mono text-[10px] text-slate-400">({preset.hex})</span>
                </span>
              ))}
            </div>

            {/* Add Additional Category (Future Expansion Requirement) */}
            <div className="p-4 bg-white border border-dashed border-slate-300 rounded-xl space-y-3">
              <p className="text-xs font-bold text-slate-700">
                + เพิ่มประเภทโต๊ะเพิ่มเติม (เช่น VVIP, Sponsor, Press)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">ชื่อประเภทใหม่</label>
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="เช่น VVIP"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">ชื่อแผ่นงาน</label>
                  <input
                    type="text"
                    value={newCatSheet}
                    onChange={(e) => setNewCatSheet(e.target.value)}
                    placeholder="เช่น VVIP"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">เลือกสีประจำประเภท</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={newCatColor}
                      onChange={(e) => setNewCatColor(e.target.value)}
                      className="w-8 h-8 rounded border border-slate-300 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-600">{newCatColor}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddCategory}
                  disabled={!newCatName.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  เพิ่มประเภทโต๊ะ
                </button>
              </div>
            </div>
          </section>

          {/* Section 3: Live Detected Column Mapping from Real Headers */}
          {categoryResults.length > 0 && (
            <section className="space-y-3 pt-4 border-t border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Table className="w-4 h-4 text-blue-600" />
                3. การตรวจสอบโครงสร้างหัวตารางจริง (Dynamic Column Header Mapping)
              </h3>
              <p className="text-xs text-slate-500">
                ระบบอ่านข้อมูลจากชื่อหัวตารางจริงโดยอัตโนมัติ รองรับการสลับคอลัมน์ตามชื่อหัวข้อ
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {categoryResults.map((res) => (
                  <div
                    key={res.categoryId}
                    className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between font-bold text-slate-800">
                      <span>
                        ประเภท {res.categoryName} (แผ่นงาน: {res.sheetName})
                      </span>
                      <span
                        className={
                          res.foundSheet ? 'text-emerald-700' : 'text-red-600'
                        }
                      >
                        {res.foundSheet
                          ? `พบ ${res.records.length} โต๊ะ`
                          : 'ไม่พบแผ่นงาน'}
                      </span>
                    </div>

                    {res.columnMap ? (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600 font-mono">
                        <span>
                          เลขโต๊ะ: คอลัมน์ {indexToColumnLetter(res.columnMap.tableNumberIdx)}
                        </span>
                        <span>
                          ชื่อ-นามสกุล: คอลัมน์ {indexToColumnLetter(res.columnMap.fullNameIdx)}
                        </span>
                        <span>
                          เบอร์โทร: คอลัมน์ {indexToColumnLetter(res.columnMap.phoneIdx)}
                        </span>
                        <span>
                          ยอดโอน: คอลัมน์ {indexToColumnLetter(res.columnMap.transferAmountIdx)}
                        </span>
                        <span>
                          วันที่โอน: คอลัมน์ {indexToColumnLetter(res.columnMap.transferDateIdx)}
                        </span>
                        <span>
                          ลิ้งค์สลีป: คอลัมน์ {indexToColumnLetter(res.columnMap.slipUrlIdx)}
                        </span>
                        <span className="col-span-2 font-semibold text-slate-800">
                          โอนแล้ว (สถานะชำระเงิน): คอลัมน์{' '}
                          {indexToColumnLetter(res.columnMap.paidStatusIdx)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400">
                        {res.error || 'ยังไม่มีข้อมูลในแผ่นงานนี้'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleApplyAndSave}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              บันทึกการตั้งค่าสีและแผ่นงาน
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
