import React, { useState, useEffect, useMemo } from 'react';
import {
  Phone,
  User,
  Calendar,
  CreditCard,
  CheckCircle2,
  XCircle,
  FileText,
  Pencil,
  Save,
  RotateCcw,
  Upload,
  Trash2,
  Eye,
  ZoomIn,
  UserCheck,
  Clock,
  Ticket,
  StickyNote,
  Plus,
} from 'lucide-react';
import { SeatRecord } from '../types/booking';
import { buildUpdatedSeatRecord } from '../utils/excelTemplate';
import { compressImageFileToDataUrl, sanitizeSafeUrl } from '../utils/media';
import {
  SlipPreviewModal,
  resolveSlipImageCandidates,
} from './SlipPreviewModal';

interface BookingCardProps {
  record: SeatRecord;
  categoryColor: string;
  onUpdateRecord?: (updated: SeatRecord) => void;
  onDeleteRecord?: (recordId: string) => void;
  defaultEditing?: boolean;
  embedded?: boolean;
}

export function formatBaht(amount: number, rawAmount?: string): string {
  if (amount > 0) {
    return `${amount.toLocaleString('th-TH', {
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })} บาท`;
  }
  if (rawAmount && rawAmount.trim() && rawAmount.trim() !== '-' && rawAmount.trim() !== '0') {
    const cleaned = rawAmount.trim();
    return cleaned.includes('บาท') ? cleaned : `${cleaned} บาท`;
  }
  return '0 บาท';
}

export function formatNowCheckInTimestamp(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString('th-TH', {
    day: '2-digit',
    month: '2-digit',
  });
  const timePart = now.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} ${timePart} น.`;
}

export const BookingCard: React.FC<BookingCardProps> = ({
  record,
  categoryColor,
  onUpdateRecord,
  onDeleteRecord,
  defaultEditing = false,
  embedded = false,
}) => {
  const [isEditing, setIsEditing] = useState(defaultEditing);
  const [tableNumber, setTableNumber] = useState(record.tableNumber);
  const [fullName, setFullName] = useState(record.fullName);
  const [phone, setPhone] = useState(record.phone);
  const [transferAmountStr, setTransferAmountStr] = useState(
    record.transferAmount > 0 ? String(record.transferAmount) : record.rawTransferAmount || ''
  );
  const [transferDate, setTransferDate] = useState(record.transferDate);
  const [slipUrl, setSlipUrl] = useState(record.slipUrl);
  const [slipUrl2, setSlipUrl2] = useState(record.slipUrl2 || '');
  const [isPaid, setIsPaid] = useState(record.isPaid);
  const [isCheckedIn, setIsCheckedIn] = useState(Boolean(record.isCheckedIn));
  const [checkedInAt, setCheckedInAt] = useState(record.checkedInAt || '');
  const [isTicketCollected, setIsTicketCollected] = useState(
    Boolean(record.isTicketCollected)
  );
  const [ticketCollectedAt, setTicketCollectedAt] = useState(
    record.ticketCollectedAt || ''
  );
  const [note, setNote] = useState(record.note || '');
  const [isQuickEditingNote, setIsQuickEditingNote] = useState(false);
  const [quickNoteDraft, setQuickNoteDraft] = useState(record.note || '');
  const [savedNotice, setSavedNotice] = useState(false);

  // Slip Popup Modal State (1 = สลิปที่ 1, 2 = สลิปที่ 2, null = ปิด)
  const [activeSlipSlot, setActiveSlipSlot] = useState<1 | 2 | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [thumb2Failed, setThumb2Failed] = useState(false);

  useEffect(() => {
    setTableNumber(record.tableNumber);
    setFullName(record.fullName);
    setPhone(record.phone);
    setTransferAmountStr(
      record.transferAmount > 0 ? String(record.transferAmount) : record.rawTransferAmount || ''
    );
    setTransferDate(record.transferDate);
    setSlipUrl(record.slipUrl);
    setSlipUrl2(record.slipUrl2 || '');
    setIsPaid(record.isPaid);
    setIsCheckedIn(Boolean(record.isCheckedIn));
    setCheckedInAt(record.checkedInAt || '');
    setIsTicketCollected(Boolean(record.isTicketCollected));
    setTicketCollectedAt(record.ticketCollectedAt || '');
    setNote(record.note || '');
    setQuickNoteDraft(record.note || '');
    setIsQuickEditingNote(false);
    setThumbFailed(false);
    setThumb2Failed(false);
  }, [record]);

  const slipCandidates = useMemo(
    () => resolveSlipImageCandidates(record.slipUrl || ''),
    [record.slipUrl]
  );

  const slip2Candidates = useMemo(
    () => resolveSlipImageCandidates(record.slipUrl2 || ''),
    [record.slipUrl2]
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onUpdateRecord) return;

    const numericAmount = Number(String(transferAmountStr).replace(/[,฿\s]|บาท/gi, '').trim());
    const finalCheckedInAt = isCheckedIn
      ? checkedInAt.trim() || formatNowCheckInTimestamp()
      : '';
    const finalTicketCollectedAt = isTicketCollected
      ? ticketCollectedAt.trim() || formatNowCheckInTimestamp()
      : '';

    const updated = buildUpdatedSeatRecord(record, {
      tableNumber: tableNumber.trim() || record.tableNumber,
      fullName: fullName.trim(),
      phone: phone.trim(),
      transferAmount: Number.isFinite(numericAmount) ? Math.max(0, numericAmount) : 0,
      rawTransferAmount: transferAmountStr.trim(),
      transferDate: transferDate.trim(),
      slipUrl: sanitizeSafeUrl(slipUrl),
      slipUrl2: sanitizeSafeUrl(slipUrl2),
      isPaid,
      isCheckedIn,
      checkedInAt: finalCheckedInAt,
      isTicketCollected,
      ticketCollectedAt: finalTicketCollectedAt,
      note: note.trim(),
    });

    onUpdateRecord(updated);
    setIsEditing(false);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleQuickSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onUpdateRecord) return;
    const trimmedNote = quickNoteDraft.trim();
    const updated = buildUpdatedSeatRecord(record, {
      note: trimmedNote,
    });
    onUpdateRecord(updated);
    setNote(trimmedNote);
    setIsQuickEditingNote(false);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleQuickTogglePaid = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!onUpdateRecord) return;
    const nextPaid = !record.isPaid;
    const updated = buildUpdatedSeatRecord(record, {
      isPaid: nextPaid,
    });
    onUpdateRecord(updated);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleQuickToggleCheckIn = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!onUpdateRecord) return;
    const nextCheckedIn = !record.isCheckedIn;
    const nextTime = nextCheckedIn ? formatNowCheckInTimestamp() : '';
    const updated = buildUpdatedSeatRecord(record, {
      isCheckedIn: nextCheckedIn,
      checkedInAt: nextTime,
    });
    onUpdateRecord(updated);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleQuickToggleTicketCollected = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!onUpdateRecord) return;
    const nextCollected = !record.isTicketCollected;
    const nextTime = nextCollected ? formatNowCheckInTimestamp() : '';
    const updated = buildUpdatedSeatRecord(record, {
      isTicketCollected: nextCollected,
      ticketCollectedAt: nextTime,
    });
    onUpdateRecord(updated);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleClearBooking = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onUpdateRecord) return;
    const cleared = buildUpdatedSeatRecord(record, {
      fullName: '',
      phone: '',
      transferAmount: 0,
      rawTransferAmount: '',
      transferDate: '',
      slipUrl: '',
      slipUrl2: '',
      isPaid: false,
      isCheckedIn: false,
      checkedInAt: '',
      isTicketCollected: false,
      ticketCollectedAt: '',
      note: '',
    });
    onUpdateRecord(cleared);
    setIsEditing(false);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleSlipImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setSlipUrl(dataUrl);
    } catch (err) {
      console.error('Failed to process slip 1 image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleSlip2ImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setSlipUrl2(dataUrl);
    } catch (err) {
      console.error('Failed to process slip 2 image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleQuickAttachSlip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateRecord) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      const updated = buildUpdatedSeatRecord(record, {
        slipUrl: dataUrl,
      });
      onUpdateRecord(updated);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2000);
    } catch (err) {
      console.error('Failed to attach slip 1 image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const handleQuickAttachSlip2 = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateRecord) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      const updated = buildUpdatedSeatRecord(record, {
        slipUrl2: dataUrl,
      });
      onUpdateRecord(updated);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2000);
    } catch (err) {
      console.error('Failed to attach slip 2 image:', err);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <>
      <article
        className={
          embedded
            ? 'text-white transition-all'
            : 'rounded-2xl overflow-hidden shadow-lg transition-all p-4 sm:p-5 text-white border-[3px] border-white/45 ring-2 ring-slate-900/15'
        }
        style={
          embedded
            ? undefined
            : {
                backgroundColor: categoryColor,
              }
        }
        onClick={(e) => {
          if (isEditing) e.stopPropagation();
        }}
      >
        {/* Top Action & Status Bar */}
        <div className="pb-3.5 mb-4 flex flex-wrap items-center justify-between gap-2.5 border-b-2 border-white/30">
          <div className="flex flex-wrap items-center gap-2.5">
            {!embedded && (
              <>
                <span className="px-3 py-1 rounded-lg text-xs font-extrabold tracking-wide bg-white/20 backdrop-blur-xs text-white border-2 border-white/40 whitespace-nowrap shrink-0">
                  โซน {record.categoryName}
                </span>
                <span className="text-xs font-medium text-white/90">
                  แผ่นงาน: {record.sheetName} · แถวที่ {record.rowNumber}
                </span>
              </>
            )}
            {onUpdateRecord && !isEditing && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-900 hover:bg-slate-100 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                แก้ไขข้อมูลโต๊ะ
              </button>
            )}
            {savedNotice && (
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500 text-white border border-white/40 shadow-2xs">
                บันทึกข้อมูลเรียบร้อยแล้ว
              </span>
            )}
          </div>

          {/* Quick 1-Click Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">

            {/* 1-Click Ticket Collection Button */}
            {record.isTicketCollected ? (
              <button
                type="button"
                onClick={handleQuickToggleTicketCollected}
                disabled={!onUpdateRecord}
                title={
                  onUpdateRecord
                    ? 'คลิกเพื่อยกเลิกสถานะการรับบัตร'
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white border-2 border-white shadow-sm whitespace-nowrap shrink-0 ${
                  onUpdateRecord ? 'hover:bg-violet-700 cursor-pointer' : ''
                }`}
              >
                <Ticket className="w-4 h-4 shrink-0" />
                รับบัตรแล้ว{record.ticketCollectedAt ? ` (${record.ticketCollectedAt})` : ''}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleQuickToggleTicketCollected}
                disabled={!onUpdateRecord}
                title={
                  onUpdateRecord
                    ? 'คลิกเพื่อยืนยันว่าโต๊ะนี้มารับบัตรเข้างานแล้ว'
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900/80 text-white border-2 border-white/80 shadow-sm whitespace-nowrap shrink-0 ${
                  onUpdateRecord ? 'hover:bg-slate-900 cursor-pointer' : ''
                }`}
              >
                <Ticket className="w-4 h-4 shrink-0" />
                กดยืนยันรับบัตร
              </button>
            )}

            {/* 1-Click Check-In Button */}
            {record.isCheckedIn ? (
              <button
                type="button"
                onClick={handleQuickToggleCheckIn}
                disabled={!onUpdateRecord}
                title={
                  onUpdateRecord
                    ? 'คลิกเพื่อยกเลิกสถานะเช็คอิน'
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-sky-600 text-white border-2 border-white shadow-sm whitespace-nowrap shrink-0 ${
                  onUpdateRecord ? 'hover:bg-sky-700 cursor-pointer' : ''
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                เช็คอินแล้ว{record.checkedInAt ? ` (${record.checkedInAt})` : ''}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleQuickToggleCheckIn}
                disabled={!onUpdateRecord}
                title={
                  onUpdateRecord
                    ? 'คลิกเพื่อยืนยันว่าโต๊ะนี้เดินทางมาเช็คอินเข้างานแล้ว'
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900/80 text-white border-2 border-white/80 shadow-sm whitespace-nowrap shrink-0 ${
                  onUpdateRecord ? 'hover:bg-slate-900 cursor-pointer' : ''
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                กดเช็คอินเข้างาน
              </button>
            )}

            {/* Strict Column G Payment Status Badge */}
            {record.isPaid ? (
              <button
                type="button"
                onClick={handleQuickTogglePaid}
                disabled={!onUpdateRecord}
                title={onUpdateRecord ? 'คลิกเพื่อสลับสถานะการชำระเงิน' : undefined}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white border-2 border-white shadow-sm whitespace-nowrap shrink-0 ${
                  onUpdateRecord ? 'hover:bg-emerald-700 cursor-pointer' : ''
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                ชำระแล้ว
              </button>
            ) : (
              <button
                type="button"
                onClick={handleQuickTogglePaid}
                disabled={!onUpdateRecord}
                title={onUpdateRecord ? 'คลิกเพื่อยืนยันการชำระเงินทันที' : undefined}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white border-2 border-white shadow-sm whitespace-nowrap shrink-0 ${
                  onUpdateRecord ? 'hover:bg-red-700 cursor-pointer' : ''
                }`}
              >
                <XCircle className="w-4 h-4 shrink-0" />
                ยังไม่ยืนยันการชำระ
              </button>
            )}
          </div>
        </div>

        {/* Edit Mode Form inside Zone-Colored Background */}
        {isEditing ? (
          <form
            onSubmit={handleSave}
            className="bg-white text-slate-900 rounded-2xl p-5 sm:p-6 space-y-5 shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">
                  แก้ไขข้อมูลการจองโต๊ะ ({record.categoryName})
                </h4>
                <p className="text-xs text-slate-500">
                  ปรับปรุงข้อมูลผู้จอง ยอดโอน สลิป สถานะชำระเงิน หรือสถานะเช็คอินเข้างาน แล้วกดบันทึก
                </p>
              </div>
              <div className="flex items-center gap-2">
                {record.isBooked && (
                  <button
                    type="button"
                    onClick={handleClearBooking}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    ล้างข้อมูลผู้จอง (คืนโต๊ะว่าง)
                  </button>
                )}
                {onDeleteRecord && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteRecord(record.id);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    ลบโต๊ะนี้
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* เลขโต๊ะ */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  เลขโต๊ะ (คอลัมน์ A)
                </label>
                <input
                  type="text"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-sm font-mono font-bold text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* ชื่อ-นามสกุล */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  ชื่อ-นามสกุล ผู้จอง (คอลัมน์ B)
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="เช่น คุณสมชาย ใจดี (เว้นว่างหากโต๊ะว่าง)"
                  className="w-full px-3.5 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* เบอร์โทร */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  เบอร์โทรศัพท์ (คอลัมน์ C)
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="เช่น 081-234-5678"
                  className="w-full px-3.5 py-2 text-sm font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* ยอดโอน */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  ยอดโอน (บาท) (คอลัมน์ D)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={transferAmountStr}
                  onChange={(e) => setTransferAmountStr(e.target.value)}
                  placeholder="เช่น 3500"
                  className="w-full px-3.5 py-2 text-sm font-mono font-bold text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* วันที่โอน */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  วันที่โอน / เวลาโอน (คอลัมน์ E)
                </label>
                <input
                  type="text"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  placeholder="เช่น 31/10/2569 14:30"
                  className="w-full px-3.5 py-2 text-sm font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* สถานะการชำระเงิน (โอนแล้ว คอลัมน์ G) */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  สถานะการชำระเงิน (คอลัมน์ G: โอนแล้ว)
                </label>
                <div className="grid grid-cols-2 gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsPaid(true)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                      isPaid
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    ชำระแล้ว (เขียว)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPaid(false)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                      !isPaid
                        ? 'bg-red-600 text-white border-red-600 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    ยังไม่ชำระ (แดง)
                  </button>
                </div>
              </div>
            </div>

            {/* สถานะเช็คอินเข้างาน + เวลาเช็คอิน & สถานะการรับบัตร + เวลารับบัตร */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  สถานะเช็คอินหน้างาน (คอลัมน์ H)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCheckedIn(true);
                      if (!checkedInAt) setCheckedInAt(formatNowCheckInTimestamp());
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                      isCheckedIn
                        ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    เช็คอินแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCheckedIn(false);
                      setCheckedInAt('');
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                      !isCheckedIn
                        ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    ยังไม่เช็คอิน
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  เวลาเช็คอินเข้างาน (คอลัมน์ I)
                </label>
                <input
                  type="text"
                  value={checkedInAt}
                  onChange={(e) => setCheckedInAt(e.target.value)}
                  disabled={!isCheckedIn}
                  placeholder={isCheckedIn ? 'เช่น 05/11 18:30 น.' : 'ยังไม่ได้เช็คอิน'}
                  className="w-full px-3.5 py-2 text-sm font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none disabled:opacity-50"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  สถานะการรับบัตรเข้างาน (คอลัมน์ J)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsTicketCollected(true);
                      if (!ticketCollectedAt)
                        setTicketCollectedAt(formatNowCheckInTimestamp());
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                      isTicketCollected
                        ? 'bg-violet-600 text-white border-violet-600 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <Ticket className="w-3.5 h-3.5" />
                    รับบัตรแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsTicketCollected(false);
                      setTicketCollectedAt('');
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                      !isTicketCollected
                        ? 'bg-slate-800 text-white border-slate-800 shadow-2xs'
                        : 'bg-slate-50 text-slate-600 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    ยังไม่รับบัตร
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  เวลารับบัตรเข้างาน (คอลัมน์ K)
                </label>
                <input
                  type="text"
                  value={ticketCollectedAt}
                  onChange={(e) => setTicketCollectedAt(e.target.value)}
                  disabled={!isTicketCollected}
                  placeholder={isTicketCollected ? 'เช่น 05/11 17:45 น.' : 'ยังไม่ได้รับบัตร'}
                  className="w-full px-3.5 py-2 text-sm font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none disabled:opacity-50"
                />
              </div>
            </div>

            {/* หมายเหตุประจำที่นั่ง / โต๊ะ */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                หมายเหตุประจำที่นั่ง / โต๊ะ (คอลัมน์ L)
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ระบุหมายเหตุเพิ่มเติม เช่น ขอเก้าอี้เสริม, แพ้อาหารทะเล, แขก VIP พิเศษ, ฝากบัตรไว้หน้างาน..."
                className="w-full px-3.5 py-2 text-sm text-slate-900 bg-amber-50/40 border-2 border-slate-300 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none resize-y"
              />
            </div>

            {/* หลักฐานการโอน สลิปที่ 1 & สลิปที่ 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              {/* สลิปที่ 1 */}
              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-50 border-2 border-slate-200">
                <label className="block text-xs font-bold text-slate-800">
                  หลักฐานการโอน — สลิปที่ 1 (คอลัมน์ F)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={slipUrl}
                    onChange={(e) => setSlipUrl(e.target.value)}
                    placeholder="วาง URL ลิงก์สลิปที่ 1 หรืออัปโหลดรูป..."
                    className="flex-1 min-w-[180px] px-3 py-2 text-xs font-mono text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                  />
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-xl cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    แนบรูปสลิป 1
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSlipImageUpload}
                      className="hidden"
                    />
                  </label>
                  {slipUrl && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveSlipSlot(1)}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-xl cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        ดูสลิป 1
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlipUrl('')}
                        className="px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        ลบสลิป 1
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* สลิปที่ 2 */}
              <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-50 border-2 border-slate-200">
                <label className="block text-xs font-bold text-slate-800">
                  หลักฐานการโอน — สลิปที่ 2 (คอลัมน์ M)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={slipUrl2}
                    onChange={(e) => setSlipUrl2(e.target.value)}
                    placeholder="วาง URL ลิงก์สลิปที่ 2 หรืออัปโหลดรูป..."
                    className="flex-1 min-w-[180px] px-3 py-2 text-xs font-mono text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-none"
                  />
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-xl cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    แนบรูปสลิป 2
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleSlip2ImageUpload}
                      className="hidden"
                    />
                  </label>
                  {slipUrl2 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveSlipSlot(2)}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-xl cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        ดูสลิป 2
                      </button>
                      <button
                        type="button"
                        onClick={() => setSlipUrl2('')}
                        className="px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        ลบสลิป 2
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white rounded-xl shadow-xs transition-opacity hover:opacity-90 cursor-pointer"
                style={{ backgroundColor: categoryColor }}
              >
                <Save className="w-3.5 h-3.5" />
                บันทึกการแก้ไข
              </button>
            </div>
          </form>
        ) : (
          /* Main Content Grid inside Zone-Colored Background: 3 Balanced Columns (4-4-4) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4 items-stretch">
            {/* Section 1: ข้อมูลผู้จอง & หมายเหตุ */}
            <div className="lg:col-span-4 bg-white text-slate-900 rounded-2xl p-4 border-2 border-slate-900/15 shadow-xs flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      ข้อมูลการจอง
                    </p>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xs font-semibold text-slate-500">โต๊ะ</span>
                      <h3
                        className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight"
                        style={{ color: categoryColor }}
                      >
                        {record.tableNumber}
                      </h3>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                      record.isBooked
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {record.isBooked ? 'จองแล้ว' : 'โต๊ะว่าง'}
                  </span>
                </div>

                <div className="space-y-2.5 pt-3">
                  <div className="flex items-start gap-2.5">
                    <User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-500">ชื่อ-นามสกุล ผู้จอง</p>
                      <p className="text-sm sm:text-base font-bold text-slate-900 break-words">
                        {record.fullName || (
                          <span className="text-slate-400 font-normal">ยังไม่มีข้อมูลผู้จอง</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <Phone className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-500">เบอร์โทรศัพท์</p>
                      {record.phone ? (
                        <a
                          href={`tel:${record.phone.replace(/\s+/g, '')}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm sm:text-base font-mono tabular-nums font-bold text-slate-800 hover:text-blue-600 transition-colors"
                        >
                          {record.phone}
                        </a>
                      ) : (
                        <p className="text-xs text-slate-400">ไม่ได้ระบุเบอร์โทร</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* หมายเหตุประจำที่นั่ง / โต๊ะ */}
              <div
                className="pt-2.5 border-t border-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-amber-800 flex items-center gap-1">
                    <StickyNote className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    หมายเหตุประจำที่นั่ง
                  </span>
                  {onUpdateRecord && !isQuickEditingNote && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setQuickNoteDraft(record.note || '');
                        setIsQuickEditingNote(true);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 transition-colors cursor-pointer"
                    >
                      {record.note ? (
                        <>
                          <Pencil className="w-2.5 h-2.5" />
                          แก้ไข
                        </>
                      ) : (
                        <>
                          <Plus className="w-2.5 h-2.5" />
                          เพิ่มหมายเหตุ
                        </>
                      )}
                    </button>
                  )}
                </div>

                {isQuickEditingNote ? (
                  <form onSubmit={handleQuickSaveNote} className="space-y-1.5 mt-1">
                    <textarea
                      rows={2}
                      autoFocus
                      value={quickNoteDraft}
                      onChange={(e) => setQuickNoteDraft(e.target.value)}
                      placeholder="พิมพ์หมายเหตุ เช่น ขอเก้าอี้เสริม, แพ้อาหาร, ฝากบัตร..."
                      className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-amber-50/70 border-2 border-amber-400 rounded-xl focus:bg-white focus:border-slate-900 focus:outline-none"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      {record.note && (
                        <button
                          type="button"
                          onClick={() => setQuickNoteDraft('')}
                          className="px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 rounded-lg cursor-pointer mr-auto"
                        >
                          ล้าง
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setQuickNoteDraft(record.note || '');
                          setIsQuickEditingNote(false);
                        }}
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                      >
                        <Save className="w-3 h-3" />
                        บันทึก
                      </button>
                    </div>
                  </form>
                ) : record.note ? (
                  <div
                    onClick={() => {
                      if (onUpdateRecord) {
                        setQuickNoteDraft(record.note || '');
                        setIsQuickEditingNote(true);
                      }
                    }}
                    title={onUpdateRecord ? 'คลิกเพื่อแก้ไขหมายเหตุ' : undefined}
                    className={`p-2 rounded-xl bg-amber-50/90 border-2 border-amber-300 text-xs font-medium text-amber-950 whitespace-pre-wrap break-words leading-snug ${
                      onUpdateRecord ? 'cursor-pointer hover:bg-amber-100/80 transition-colors' : ''
                    }`}
                  >
                    {record.note}
                  </div>
                ) : (
                  <p
                    onClick={() => {
                      if (onUpdateRecord) {
                        setQuickNoteDraft('');
                        setIsQuickEditingNote(true);
                      }
                    }}
                    className={`text-xs text-slate-400 italic ${
                      onUpdateRecord ? 'cursor-pointer hover:text-slate-600' : ''
                    }`}
                  >
                    ยังไม่มีหมายเหตุ
                  </p>
                )}
              </div>
            </div>

            {/* Section 2: ข้อมูลการชำระเงิน การรับบัตร & เช็คอิน */}
            <div className="lg:col-span-4 bg-white text-slate-900 rounded-2xl p-4 border-2 border-slate-900/15 shadow-xs flex flex-col justify-between space-y-3">
              <div className="pb-3 border-b border-slate-100">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  ยอดโอน &amp; สถานะหน้างาน
                </p>
                <div className="flex items-baseline justify-between gap-2 mt-1">
                  <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                    <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                    ยอดโอนสุทธิ
                  </span>
                  <p className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900">
                    {formatBaht(record.transferAmount, record.rawTransferAmount)}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    วันที่โอน
                  </span>
                  <span className="font-mono tabular-nums font-bold text-slate-800">
                    {record.transferDate || '-'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <span className="text-slate-500">การชำระเงิน</span>
                  <span
                    className={`inline-flex items-center gap-1 font-bold ${
                      record.isPaid ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {record.isPaid ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        ชำระแล้ว
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" />
                        ยังไม่ชำระ
                      </>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Ticket className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    การรับบัตร
                  </span>
                  <span
                    className={`font-bold font-mono text-right ${
                      record.isTicketCollected ? 'text-violet-700' : 'text-slate-400'
                    }`}
                  >
                    {record.isTicketCollected
                      ? `รับแล้ว ${record.ticketCollectedAt || ''}`
                      : 'ยังไม่รับบัตร'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 py-1 px-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    เช็คอินเข้างาน
                  </span>
                  <span
                    className={`font-bold font-mono text-right ${
                      record.isCheckedIn ? 'text-sky-700' : 'text-slate-400'
                    }`}
                  >
                    {record.isCheckedIn
                      ? `เช็คอินแล้ว ${record.checkedInAt || ''}`
                      : 'ยังไม่เช็คอิน'}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 3: หลักฐานการโอน (สลิปที่ 1 & สลิปที่ 2 จัดวางคู่กันอย่างสมดุล ไม่ล้นกรอบ) */}
            <div className="lg:col-span-4 bg-white text-slate-900 rounded-2xl p-4 border-2 border-slate-900/15 shadow-xs flex flex-col justify-between space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  หลักฐานการโอน
                </p>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                  แนบแล้ว {[Boolean(record.slipUrl), Boolean(record.slipUrl2)].filter(Boolean).length}/2 สลิป
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 flex-1">
                {/* สลิปที่ 1 */}
                <div className="p-2.5 rounded-xl bg-slate-50 border-2 border-slate-200 flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-extrabold text-slate-800">
                      สลิปที่ 1
                    </span>
                    {record.slipUrl ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        มีสลิป
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-500">
                        ว่าง
                      </span>
                    )}
                  </div>

                  {record.slipUrl ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSlipSlot(1);
                        }}
                        className="group relative w-full h-24 rounded-lg overflow-hidden border-2 border-slate-300 bg-white flex items-center justify-center cursor-pointer"
                        title="คลิกเพื่อเปิดดูรูปสลิปที่ 1 ขนาดใหญ่"
                      >
                        {!thumbFailed ? (
                          <img
                            src={slipCandidates.primaryImgUrl}
                            alt={`สลิปที่ 1 โต๊ะ ${record.tableNumber}`}
                            onError={() => setThumbFailed(true)}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-500 gap-1 p-1.5">
                            <FileText className="w-5 h-5 text-slate-400" />
                            <span className="text-[10px] font-semibold">เปิดสลิป 1</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/95 text-slate-900 text-[10px] font-bold shadow-sm">
                            <ZoomIn className="w-3 h-3" />
                            ขยาย
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSlipSlot(1);
                        }}
                        className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold text-white rounded-lg transition-opacity hover:opacity-90 whitespace-nowrap shadow-2xs cursor-pointer"
                        style={{ backgroundColor: categoryColor }}
                      >
                        <Eye className="w-3.5 h-3.5 shrink-0" />
                        ดูสลิปที่ 1
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-full h-24 flex flex-col items-center justify-center gap-1 px-2 text-[11px] font-medium text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-lg">
                        <FileText className="w-4 h-4 text-slate-300 shrink-0" />
                        <span>ไม่มีสลิป 1</span>
                      </div>
                      {onUpdateRecord && (
                        <label
                          onClick={(e) => e.stopPropagation()}
                          className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                        >
                          <Upload className="w-3 h-3 shrink-0" />
                          แนบสลิป 1
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleQuickAttachSlip}
                            className="hidden"
                          />
                        </label>
                      )}
                    </>
                  )}
                </div>

                {/* สลิปที่ 2 */}
                <div className="p-2.5 rounded-xl bg-slate-50 border-2 border-slate-200 flex flex-col justify-between space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-extrabold text-slate-800">
                      สลิปที่ 2
                    </span>
                    {record.slipUrl2 ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        มีสลิป
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-500">
                        ว่าง
                      </span>
                    )}
                  </div>

                  {record.slipUrl2 ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSlipSlot(2);
                        }}
                        className="group relative w-full h-24 rounded-lg overflow-hidden border-2 border-slate-300 bg-white flex items-center justify-center cursor-pointer"
                        title="คลิกเพื่อเปิดดูรูปสลิปที่ 2 ขนาดใหญ่"
                      >
                        {!thumb2Failed ? (
                          <img
                            src={slip2Candidates.primaryImgUrl}
                            alt={`สลิปที่ 2 โต๊ะ ${record.tableNumber}`}
                            onError={() => setThumb2Failed(true)}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-500 gap-1 p-1.5">
                            <FileText className="w-5 h-5 text-slate-400" />
                            <span className="text-[10px] font-semibold">เปิดสลิป 2</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/95 text-slate-900 text-[10px] font-bold shadow-sm">
                            <ZoomIn className="w-3 h-3" />
                            ขยาย
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSlipSlot(2);
                        }}
                        className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold text-white rounded-lg transition-opacity hover:opacity-90 whitespace-nowrap shadow-2xs cursor-pointer"
                        style={{ backgroundColor: categoryColor }}
                      >
                        <Eye className="w-3.5 h-3.5 shrink-0" />
                        ดูสลิปที่ 2
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-full h-24 flex flex-col items-center justify-center gap-1 px-2 text-[11px] font-medium text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-lg">
                        <FileText className="w-4 h-4 text-slate-300 shrink-0" />
                        <span>ไม่มีสลิป 2</span>
                      </div>
                      {onUpdateRecord && (
                        <label
                          onClick={(e) => e.stopPropagation()}
                          className="w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border-2 border-slate-300 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                        >
                          <Upload className="w-3 h-3 shrink-0" />
                          แนบสลิป 2
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleQuickAttachSlip2}
                            className="hidden"
                          />
                        </label>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </article>

      {/* Slip Image Preview Popup Modal (รองรับทั้งสลิปที่ 1 และสลิปที่ 2) */}
      <SlipPreviewModal
        preview={
          activeSlipSlot === 1 && (isEditing ? slipUrl : record.slipUrl)
            ? {
                slipUrl: isEditing ? slipUrl : record.slipUrl,
                title: `หลักฐานการโอน (สลิปที่ 1) — โต๊ะ ${record.tableNumber}`,
                subtitle: record.fullName
                  ? `ผู้จอง: ${record.fullName}${record.phone ? ` (${record.phone})` : ''}`
                  : `แผ่นงาน ${record.sheetName} · แถวที่ ${record.rowNumber}`,
                badgeText: `โซน ${record.categoryName} · สลิปที่ 1`,
                accentColor: categoryColor,
                amountText: formatBaht(record.transferAmount, record.rawTransferAmount),
                dateText: record.transferDate || '-',
                isPaid: record.isPaid,
                onTogglePaid: onUpdateRecord ? () => handleQuickTogglePaid() : undefined,
                onReplaceSlipUrl: onUpdateRecord
                  ? (newDataUrl) => {
                      if (isEditing) {
                        setSlipUrl(newDataUrl);
                      } else {
                        const updated = buildUpdatedSeatRecord(record, {
                          slipUrl: newDataUrl,
                        });
                        onUpdateRecord(updated);
                      }
                    }
                  : undefined,
              }
            : activeSlipSlot === 2 && (isEditing ? slipUrl2 : record.slipUrl2)
            ? {
                slipUrl: (isEditing ? slipUrl2 : record.slipUrl2) || '',
                title: `หลักฐานการโอน (สลิปที่ 2) — โต๊ะ ${record.tableNumber}`,
                subtitle: record.fullName
                  ? `ผู้จอง: ${record.fullName}${record.phone ? ` (${record.phone})` : ''}`
                  : `แผ่นงาน ${record.sheetName} · แถวที่ ${record.rowNumber}`,
                badgeText: `โซน ${record.categoryName} · สลิปที่ 2`,
                accentColor: categoryColor,
                amountText: formatBaht(record.transferAmount, record.rawTransferAmount),
                dateText: record.transferDate || '-',
                isPaid: record.isPaid,
                onTogglePaid: onUpdateRecord ? () => handleQuickTogglePaid() : undefined,
                onReplaceSlipUrl: onUpdateRecord
                  ? (newDataUrl) => {
                      if (isEditing) {
                        setSlipUrl2(newDataUrl);
                      } else {
                        const updated = buildUpdatedSeatRecord(record, {
                          slipUrl2: newDataUrl,
                        });
                        onUpdateRecord(updated);
                      }
                    }
                  : undefined,
              }
            : null
        }
        onClose={() => setActiveSlipSlot(null)}
      />
    </>
  );
};
