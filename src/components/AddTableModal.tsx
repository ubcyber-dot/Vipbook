import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Layers,
  CheckCircle2,
  XCircle,
  Upload,
  Eye,
  AlertCircle,
  Sparkles,
  Users,
  StickyNote,
} from 'lucide-react';
import { CategoryConfig, SeatRecord } from '../types/booking';
import {
  buildUpdatedSeatRecord,
  normalizeTableNo,
  compactTableNo,
} from '../utils/excelTemplate';
import { compressImageFileToDataUrl, sanitizeSafeUrl } from '../utils/media';
import { SlipPreviewModal } from './SlipPreviewModal';

interface AddTableModalProps {
  isOpen: boolean;
  categories: CategoryConfig[];
  existingRecords: SeatRecord[];
  initialCategoryId?: string;
  initialTableNumber?: string;
  onAddRecord: (categoryId: string, record: SeatRecord) => void;
  onAddMultipleRecords?: (categoryId: string, records: SeatRecord[]) => void;
  onClose: () => void;
}

/**
 * Analyze existing table numbers in a zone to suggest the next sequential table number
 * and default prefix/padding for batch creation.
 */
function analyzeZoneTablePattern(
  catRecords: SeatRecord[],
  categoryId: string,
  categoryName: string
): {
  suggestedNextTable: string;
  detectedPrefix: string;
  nextNumber: number;
  padLength: number;
} {
  const defaultPrefix =
    categoryId === 'vip' || categoryName.toUpperCase().includes('VIP')
      ? 'VIP-'
      : 'A';

  if (catRecords.length === 0) {
    return {
      suggestedNextTable: `${defaultPrefix}01`,
      detectedPrefix: defaultPrefix,
      nextNumber: 1,
      padLength: 2,
    };
  }

  let maxNum = 0;
  let bestPrefix = defaultPrefix;
  let bestPad = 2;

  for (const r of catRecords) {
    const raw = r.tableNumber.trim();
    const match = raw.match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const numStr = match[2];
      const numVal = parseInt(numStr, 10);
      if (Number.isFinite(numVal) && numVal >= maxNum) {
        maxNum = numVal;
        bestPrefix = prefix;
        bestPad = numStr.length >= 2 ? numStr.length : 1;
      }
    }
  }

  const nextNumber = maxNum + 1;
  const formattedNum =
    bestPad > 1 ? String(nextNumber).padStart(bestPad, '0') : String(nextNumber);

  return {
    suggestedNextTable: `${bestPrefix}${formattedNum}`,
    detectedPrefix: bestPrefix,
    nextNumber,
    padLength: bestPad,
  };
}

export const AddTableModal: React.FC<AddTableModalProps> = ({
  isOpen,
  categories,
  existingRecords,
  initialCategoryId,
  initialTableNumber = '',
  onAddRecord,
  onAddMultipleRecords,
  onClose,
}) => {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    initialCategoryId || categories[0]?.id || 'vip'
  );

  // Single Table Form State
  const [tableNumber, setTableNumber] = useState<string>('');
  const [markAsBooked, setMarkAsBooked] = useState<boolean>(true);
  const [fullName, setFullName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [transferAmountStr, setTransferAmountStr] = useState<string>('');
  const [transferDate, setTransferDate] = useState<string>('');
  const [slipUrl, setSlipUrl] = useState<string>('');
  const [slipUrl2, setSlipUrl2] = useState<string>('');
  const [isPaid, setIsPaid] = useState<boolean>(false);
  const [note, setNote] = useState<string>('');
  const [previewingSlipSlot, setPreviewingSlipSlot] = useState<1 | 2 | null>(null);

  // Batch Range Form State
  const [batchPrefix, setBatchPrefix] = useState<string>('VIP-');
  const [batchStartStr, setBatchStartStr] = useState<string>('21');
  const [batchEndStr, setBatchEndStr] = useState<string>('30');
  const [batchPadLength, setBatchPadLength] = useState<number>(2);
  const [batchMarkAsBooked, setBatchMarkAsBooked] = useState<boolean>(false);
  const [batchNote, setBatchNote] = useState<string>('');

  const selectedCategory = useMemo(
    () =>
      categories.find((c) => c.id === selectedCategoryId) ||
      categories[0] || {
        id: 'vip',
        name: 'VIP',
        sheetName: 'VIP',
        colorHex: '#D97706',
      },
    [categories, selectedCategoryId]
  );

  const zoneRecords = useMemo(
    () => existingRecords.filter((r) => r.categoryId === selectedCategory.id),
    [existingRecords, selectedCategory.id]
  );

  const pattern = useMemo(
    () =>
      analyzeZoneTablePattern(
        zoneRecords,
        selectedCategory.id,
        selectedCategory.name
      ),
    [zoneRecords, selectedCategory.id, selectedCategory.name]
  );

  // Initialize form when modal opens or initial props change
  useEffect(() => {
    if (!isOpen) return;
    const targetCatId =
      initialCategoryId && categories.some((c) => c.id === initialCategoryId)
        ? initialCategoryId
        : categories[0]?.id || 'vip';
    setSelectedCategoryId(targetCatId);
    setMode('single');
    setMarkAsBooked(true);
    setBatchMarkAsBooked(false);
    setFullName('');
    setPhone('');
    setTransferAmountStr('');
    setTransferDate('');
    setSlipUrl('');
    setSlipUrl2('');
    setIsPaid(false);
    setNote('');
    setBatchNote('');
  }, [isOpen, initialCategoryId, categories]);

  // Update suggested table number & batch defaults when zone changes or modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (initialTableNumber && initialTableNumber.trim()) {
      setTableNumber(initialTableNumber.trim().toUpperCase());
    } else {
      setTableNumber(pattern.suggestedNextTable);
    }
    setBatchPrefix(pattern.detectedPrefix);
    setBatchStartStr(String(pattern.nextNumber));
    setBatchEndStr(String(pattern.nextNumber + 9));
    setBatchPadLength(pattern.padLength);
  }, [isOpen, initialTableNumber, pattern]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewingSlipSlot) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, previewingSlipSlot, onClose]);

  // Check if single tableNumber already exists in the selected zone
  const duplicateInZone = useMemo(() => {
    const norm = normalizeTableNo(tableNumber);
    const comp = compactTableNo(tableNumber);
    if (!norm) return null;
    return (
      zoneRecords.find(
        (r) =>
          r.normalizedTableNumber === norm ||
          (comp.length >= 2 && r.compactTableNumber === comp)
      ) || null
    );
  }, [zoneRecords, tableNumber]);

  // Calculate Batch Preview
  const batchPreview = useMemo(() => {
    const parsedStart = Number(batchStartStr);
    const parsedEnd = Number(batchEndStr);
    const start = Number.isFinite(parsedStart) && parsedStart >= 1 ? Math.floor(parsedStart) : 1;
    const end =
      Number.isFinite(parsedEnd) && parsedEnd >= start
        ? Math.min(start + 199, Math.floor(parsedEnd))
        : start;
    const existingNormSet = new Set(zoneRecords.map((r) => r.normalizedTableNumber));

    const toCreate: string[] = [];
    const skippedDuplicates: string[] = [];

    for (let num = start; num <= end; num++) {
      const numStr =
        batchPadLength > 1 ? String(num).padStart(batchPadLength, '0') : String(num);
      const candidate = `${batchPrefix.trim()}${numStr}`;
      const norm = normalizeTableNo(candidate);
      if (!norm) continue;
      if (existingNormSet.has(norm)) {
        skippedDuplicates.push(candidate);
      } else {
        toCreate.push(candidate);
      }
    }

    return {
      toCreate,
      skippedDuplicates,
      start,
      end,
    };
  }, [batchPrefix, batchStartStr, batchEndStr, batchPadLength, zoneRecords]);

  if (!isOpen) return null;

  const zoneColor = selectedCategory.colorHex || '#2563EB';

  const handleSlipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setSlipUrl(dataUrl);
      setMarkAsBooked(true);
    } catch (err) {
      console.error('Failed to process slip 1 image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleSlip2Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setSlipUrl2(dataUrl);
      setMarkAsBooked(true);
    } catch (err) {
      console.error('Failed to process slip 2 image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleSingleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedNo = tableNumber.trim();
    if (!trimmedNo || duplicateInZone) return;

    const nextRowNumber =
      zoneRecords.reduce((max, r) => Math.max(max, r.rowNumber || 0), 1) + 1;
    const amountVal = Number(
      String(transferAmountStr).replace(/[,฿\s]|บาท/gi, '').trim()
    );
    const validAmount = Number.isFinite(amountVal) ? Math.max(0, amountVal) : 0;

    const effectiveFullName = markAsBooked
      ? fullName.trim() || `ผู้จองโต๊ะ ${trimmedNo}`
      : '';

    const baseRecord: SeatRecord = {
      id: `${selectedCategory.id}-custom-${Date.now()}-${normalizeTableNo(trimmedNo)}`,
      rowNumber: nextRowNumber,
      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name,
      sheetName: selectedCategory.sheetName,
      tableNumber: trimmedNo,
      normalizedTableNumber: normalizeTableNo(trimmedNo),
      compactTableNumber: compactTableNo(trimmedNo),
      fullName: effectiveFullName,
      phone: markAsBooked ? phone.trim() : '',
      transferAmount: markAsBooked ? validAmount : 0,
      rawTransferAmount: markAsBooked && validAmount > 0 ? String(validAmount) : '',
      transferDate: markAsBooked ? transferDate.trim() : '',
      slipUrl: markAsBooked ? sanitizeSafeUrl(slipUrl) : '',
      slipUrl2: markAsBooked ? sanitizeSafeUrl(slipUrl2) : '',
      rawPaidStatus: markAsBooked && isPaid ? 'TRUE' : 'FALSE',
      isPaid: markAsBooked ? isPaid : false,
      isBooked: markAsBooked,
      note: note.trim(),
    };

    const finalRecord = buildUpdatedSeatRecord(baseRecord, {});
    onAddRecord(selectedCategory.id, finalRecord);
    onClose();
  };

  const handleBatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (batchPreview.toCreate.length === 0) return;

    const baseRowNumber =
      zoneRecords.reduce((max, r) => Math.max(max, r.rowNumber || 0), 1) + 1;
    const now = Date.now();

    const createdRecords: SeatRecord[] = batchPreview.toCreate.map(
      (tableNo, idx) => {
        const base: SeatRecord = {
          id: `${selectedCategory.id}-batch-${now}-${idx}-${normalizeTableNo(tableNo)}`,
          rowNumber: baseRowNumber + idx,
          categoryId: selectedCategory.id,
          categoryName: selectedCategory.name,
          sheetName: selectedCategory.sheetName,
          tableNumber: tableNo,
          normalizedTableNumber: normalizeTableNo(tableNo),
          compactTableNumber: compactTableNo(tableNo),
          fullName: batchMarkAsBooked ? `ผู้จองโต๊ะ ${tableNo}` : '',
          phone: '',
          transferAmount: 0,
          rawTransferAmount: '',
          transferDate: '',
          slipUrl: '',
          rawPaidStatus: 'FALSE',
          isPaid: false,
          isBooked: batchMarkAsBooked,
          note: batchNote.trim(),
        };
        return buildUpdatedSeatRecord(base, {});
      }
    );

    if (onAddMultipleRecords) {
      onAddMultipleRecords(selectedCategory.id, createdRecords);
    } else {
      for (const rec of createdRecords) {
        onAddRecord(selectedCategory.id, rec);
      }
    }
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/65 backdrop-blur-xs overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="w-full max-w-2xl rounded-3xl shadow-2xl border-[3px] border-white/40 overflow-hidden my-auto transition-colors duration-200"
          style={{ backgroundColor: zoneColor }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header on Zone Color Background */}
          <div className="px-6 py-4 bg-black/15 border-b-2 border-white/25 flex items-center justify-between gap-4 text-white">
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-3 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wider bg-white text-slate-900 border-2 border-white shadow-xs">
                โซน {selectedCategory.name}
              </span>
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
                  เพิ่มโต๊ะใหม่เข้าสู่ระบบ
                </h2>
                <p className="text-xs text-white/85">
                  แผ่นงาน {selectedCategory.sheetName} · ปัจจุบันมี {zoneRecords.length} โต๊ะ
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="ปิดหน้าต่าง"
              className="p-2 text-white/90 hover:text-white bg-white/15 hover:bg-white/25 border-2 border-white/30 rounded-xl transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 sm:p-6 space-y-5 max-h-[82vh] overflow-y-auto">
            <div className="bg-white text-slate-900 rounded-2xl p-5 sm:p-6 space-y-5 border-2 border-white shadow-lg">
              {/* Step 1: Select Zone & Creation Mode */}
              <div className="space-y-4 pb-4 border-b-2 border-slate-200">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    1. เลือกโซนที่ต้องการเพิ่มโต๊ะ
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {categories.map((cat) => {
                      const active = cat.id === selectedCategory.id;
                      const count = existingRecords.filter(
                        (r) => r.categoryId === cat.id
                      ).length;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedCategoryId(cat.id)}
                          className="px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 border-2"
                          style={{
                            backgroundColor: active ? cat.colorHex : '#F8FAFC',
                            color: active ? '#FFFFFF' : '#334155',
                            borderColor: active ? cat.colorHex : '#CBD5E1',
                          }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: active ? '#FFFFFF' : cat.colorHex,
                            }}
                          />
                          <span>
                            โซน {cat.name} ({count} โต๊ะ)
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Mode Switcher */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    2. เลือกรูปแบบการเพิ่มโต๊ะ
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 bg-slate-100 border-2 border-slate-300 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setMode('single')}
                      className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                        mode === 'single'
                          ? 'bg-white text-slate-900 border-2 border-slate-300 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 border-2 border-transparent'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      เพิ่มทีละโต๊ะ (พร้อมข้อมูลผู้จอง/สลิป)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('batch')}
                      className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                        mode === 'batch'
                          ? 'bg-white text-slate-900 border-2 border-slate-300 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 border-2 border-transparent'
                      }`}
                    >
                      <Layers className="w-4 h-4" />
                      เพิ่มหลายโต๊ะรวดเดียว (ระบุช่วงเลขโต๊ะ)
                    </button>
                  </div>
                </div>
              </div>

              {/* MODE 1: SINGLE TABLE CREATION */}
              {mode === 'single' ? (
                <form onSubmit={handleSingleSubmit} className="space-y-4">
                  {/* สถานะการจองโต๊ะ */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border-2 border-slate-300 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-slate-700" />
                        สถานะโต๊ะที่เพิ่มใหม่
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setMarkAsBooked(true)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border-2 transition-all cursor-pointer ${
                          markAsBooked
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        <Users className="w-4 h-4" />
                        โต๊ะที่จองแล้ว
                      </button>
                      <button
                        type="button"
                        onClick={() => setMarkAsBooked(false)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border-2 transition-all cursor-pointer ${
                          !markAsBooked
                            ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        โต๊ะว่าง (ยังไม่มีผู้จอง)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* เลขโต๊ะ */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-bold text-slate-700">
                          เลขโต๊ะ *
                        </label>
                        {tableNumber !== pattern.suggestedNextTable && (
                          <button
                            type="button"
                            onClick={() => setTableNumber(pattern.suggestedNextTable)}
                            className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
                          >
                            ใช้เลขแนะนำ ({pattern.suggestedNextTable})
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        required
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                        placeholder={`เช่น ${pattern.suggestedNextTable}`}
                        className={`w-full px-3.5 py-2.5 text-base font-mono font-extrabold bg-slate-50 border-2 rounded-xl focus:bg-white focus:outline-none ${
                          duplicateInZone
                            ? 'border-red-500 text-red-700'
                            : 'border-slate-300 text-slate-900 focus:border-slate-900'
                        }`}
                      />
                      {duplicateInZone && (
                        <p className="text-xs font-semibold text-red-600 flex items-center gap-1 pt-0.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          เลขโต๊ะ &ldquo;{tableNumber}&rdquo; มีอยู่แล้วในโซน {selectedCategory.name}
                        </p>
                      )}
                    </div>

                    {/* ชื่อผู้จอง */}
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        {markAsBooked
                          ? 'ชื่อ-นามสกุล ผู้จอง (เว้นว่างเพื่อใช้ชื่อโต๊ะอัตโนมัติได้)'
                          : 'ชื่อ-นามสกุล ผู้จอง (สำหรับโต๊ะที่จอง)'}
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (e.target.value.trim()) setMarkAsBooked(true);
                        }}
                        placeholder={
                          markAsBooked
                            ? `เช่น คุณสมชาย ใจดี`
                            : 'ระบุชื่อผู้จอง...'
                        }
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    {/* เบอร์โทรศัพท์ */}
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        เบอร์โทรศัพท์
                      </label>
                      <input
                        type="text"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          if (e.target.value.trim()) setMarkAsBooked(true);
                        }}
                        placeholder="เช่น 081-234-5678"
                        className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    {/* ยอดโอน */}
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        ยอดโอน (บาท)
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={transferAmountStr}
                        onChange={(e) => {
                          setTransferAmountStr(e.target.value);
                          if (Number(e.target.value) > 0) setMarkAsBooked(true);
                        }}
                        placeholder="เช่น 3500"
                        className="w-full px-3.5 py-2 text-sm font-mono font-bold bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    {/* วันที่โอน */}
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        วันที่โอน / เวลาโอน
                      </label>
                      <input
                        type="text"
                        value={transferDate}
                        onChange={(e) => setTransferDate(e.target.value)}
                        placeholder="เช่น 05/11/2569 14:30"
                        className="w-full px-3.5 py-2 text-sm font-mono bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    {/* สถานะชำระเงิน */}
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        สถานะการชำระเงิน
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPaid(true);
                            setMarkAsBooked(true);
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border-2 transition-colors cursor-pointer ${
                            isPaid
                              ? 'bg-emerald-600 text-white border-emerald-700'
                              : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          ชำระแล้ว
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsPaid(false)}
                          className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border-2 transition-colors cursor-pointer ${
                            !isPaid
                              ? 'bg-red-600 text-white border-red-700'
                              : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          ยังไม่ชำระ
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* หมายเหตุประจำที่นั่ง / โต๊ะ */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                      หมายเหตุประจำที่นั่ง / โต๊ะ (ถ้ามี)
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="เช่น ขอเก้าอี้เสริม, แพ้อาหาร, ฝากบัตรไว้หน้างาน..."
                      className="w-full px-3.5 py-2 text-sm bg-amber-50/40 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {/* แนบรูปสลิปที่ 1 & สลิปที่ 2 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* สลิปที่ 1 */}
                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border-2 border-slate-200">
                      <label className="block text-xs font-bold text-slate-800">
                        หลักฐานการโอน — สลิปที่ 1
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={slipUrl}
                          onChange={(e) => {
                            setSlipUrl(e.target.value);
                            if (e.target.value.trim()) setMarkAsBooked(true);
                          }}
                          placeholder="วางลิงก์รูปสลิปที่ 1 หรือกดแนบรูป..."
                          className="flex-1 min-w-[140px] px-3 py-2 text-xs font-mono bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                        />
                        <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-xl cursor-pointer shrink-0">
                          <Upload className="w-3.5 h-3.5" />
                          แนบสลิป 1
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleSlipUpload}
                            className="hidden"
                          />
                        </label>
                        {slipUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewingSlipSlot(1)}
                            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 rounded-xl cursor-pointer shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            ดูสลิป 1
                          </button>
                        )}
                      </div>
                    </div>

                    {/* สลิปที่ 2 */}
                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border-2 border-slate-200">
                      <label className="block text-xs font-bold text-slate-800">
                        หลักฐานการโอน — สลิปที่ 2 (ถ้ามี)
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={slipUrl2}
                          onChange={(e) => {
                            setSlipUrl2(e.target.value);
                            if (e.target.value.trim()) setMarkAsBooked(true);
                          }}
                          placeholder="วางลิงก์รูปสลิปที่ 2 หรือกดแนบรูป..."
                          className="flex-1 min-w-[140px] px-3 py-2 text-xs font-mono bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                        />
                        <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-xl cursor-pointer shrink-0">
                          <Upload className="w-3.5 h-3.5" />
                          แนบสลิป 2
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleSlip2Upload}
                            className="hidden"
                          />
                        </label>
                        {slipUrl2 && (
                          <button
                            type="button"
                            onClick={() => setPreviewingSlipSlot(2)}
                            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 rounded-xl cursor-pointer shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            ดูสลิป 2
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t-2 border-slate-200">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 rounded-xl cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={!tableNumber.trim() || Boolean(duplicateInZone)}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white rounded-xl border-2 border-black/15 shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      style={{ backgroundColor: zoneColor }}
                    >
                      <Plus className="w-4 h-4" />
                      บันทึกเพิ่มโต๊ะ {tableNumber.trim() || ''}
                    </button>
                  </div>
                </form>
              ) : (
                /* MODE 2: BATCH RANGE TABLE GENERATOR */
                <form onSubmit={handleBatchSubmit} className="space-y-4">
                  {/* สถานะของโต๊ะแบบกลุ่ม */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border-2 border-slate-300 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-slate-700" />
                        สถานะโต๊ะที่สร้างใหม่ทั้งหมด
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setBatchMarkAsBooked(false)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border-2 transition-all cursor-pointer ${
                          !batchMarkAsBooked
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        สร้างเป็นโต๊ะว่างทั้งหมด
                      </button>
                      <button
                        type="button"
                        onClick={() => setBatchMarkAsBooked(true)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border-2 transition-all cursor-pointer ${
                          batchMarkAsBooked
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        <Users className="w-4 h-4" />
                        สร้างเป็นโต๊ะที่จองแล้วทั้งหมด
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        คำนำหน้า (Prefix)
                      </label>
                      <input
                        type="text"
                        value={batchPrefix}
                        onChange={(e) => setBatchPrefix(e.target.value)}
                        placeholder="เช่น VIP-, A, B"
                        className="w-full px-3 py-2 text-sm font-mono font-bold bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        เลขเริ่มต้น *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="9999"
                        required
                        value={batchStartStr}
                        onChange={(e) => setBatchStartStr(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono font-bold bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        ถึงเลขสิ้นสุด *
                      </label>
                      <input
                        type="number"
                        min={batchPreview.start}
                        max={batchPreview.start + 199}
                        required
                        value={batchEndStr}
                        onChange={(e) => setBatchEndStr(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono font-bold bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-700">
                        รูปแบบตัวเลข
                      </label>
                      <select
                        value={batchPadLength}
                        onChange={(e) => setBatchPadLength(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                      >
                        <option value={2}>เติม 0 สองหลัก (01, 02)</option>
                        <option value={3}>เติม 0 สามหลัก (001, 002)</option>
                        <option value={1}>ไม่เติม 0 (1, 2, 3)</option>
                      </select>
                    </div>
                  </div>

                  {/* Live Preview Box */}
                  <div className="p-4 rounded-xl bg-slate-50 border-2 border-slate-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        ตัวอย่างโต๊ะที่จะถูกสร้างใหม่ในโซน {selectedCategory.name}:{' '}
                        <strong style={{ color: zoneColor }}>
                          {batchPreview.toCreate.length} โต๊ะ
                        </strong>
                      </span>
                      {batchPreview.skippedDuplicates.length > 0 && (
                        <span className="text-[11px] font-medium text-amber-700">
                          (ข้ามเลขที่มีอยู่แล้ว {batchPreview.skippedDuplicates.length} โต๊ะ)
                        </span>
                      )}
                    </div>

                    {batchPreview.toCreate.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
                        {batchPreview.toCreate.slice(0, 40).map((tNo) => (
                          <span
                            key={tNo}
                            className="px-2 py-0.5 rounded-md text-xs font-mono font-bold text-white border border-black/15"
                            style={{ backgroundColor: zoneColor }}
                          >
                            {tNo}
                          </span>
                        ))}
                        {batchPreview.toCreate.length > 40 && (
                          <span className="px-2 py-0.5 rounded-md text-xs font-semibold text-slate-600 bg-slate-200">
                            ...และอีก {batchPreview.toCreate.length - 40} โต๊ะ (ถึง{' '}
                            {batchPreview.toCreate[batchPreview.toCreate.length - 1]})
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-red-600 font-medium">
                        เลขโต๊ะในช่วงที่ระบุมีอยู่ในโซน {selectedCategory.name} ทั้งหมดแล้ว กรุณาเปลี่ยนช่วงตัวเลขใหม่
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t-2 border-slate-200">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border-2 border-slate-300 rounded-xl cursor-pointer"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={batchPreview.toCreate.length === 0}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white rounded-xl border-2 border-black/15 shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      style={{ backgroundColor: zoneColor }}
                    >
                      <Layers className="w-4 h-4" />
                      ยืนยันสร้างโต๊ะใหม่ {batchPreview.toCreate.length} โต๊ะ
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Slip Preview Modal if user clicks "ดูสลิป 1" or "ดูสลิป 2" inside AddTableModal */}
      <SlipPreviewModal
        preview={
          previewingSlipSlot === 1 && slipUrl
            ? {
                slipUrl,
                title: `ตัวอย่างสลิปที่ 1 โต๊ะใหม่ — ${tableNumber || pattern.suggestedNextTable}`,
                subtitle: fullName ? `ผู้จอง: ${fullName}` : undefined,
                badgeText: `โซน ${selectedCategory.name} · สลิปที่ 1`,
                accentColor: zoneColor,
                amountText: transferAmountStr ? `${transferAmountStr} บาท` : undefined,
                dateText: transferDate || '-',
                isPaid,
                onTogglePaid: () => setIsPaid((p) => !p),
                onReplaceSlipUrl: (newUrl) => setSlipUrl(newUrl),
              }
            : previewingSlipSlot === 2 && slipUrl2
            ? {
                slipUrl: slipUrl2,
                title: `ตัวอย่างสลิปที่ 2 โต๊ะใหม่ — ${tableNumber || pattern.suggestedNextTable}`,
                subtitle: fullName ? `ผู้จอง: ${fullName}` : undefined,
                badgeText: `โซน ${selectedCategory.name} · สลิปที่ 2`,
                accentColor: zoneColor,
                amountText: transferAmountStr ? `${transferAmountStr} บาท` : undefined,
                dateText: transferDate || '-',
                isPaid,
                onTogglePaid: () => setIsPaid((p) => !p),
                onReplaceSlipUrl: (newUrl) => setSlipUrl2(newUrl),
              }
            : null
        }
        onClose={() => setPreviewingSlipSlot(null)}
      />
    </>
  );
};
