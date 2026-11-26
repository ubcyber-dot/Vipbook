import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Ticket,
  UserCheck,
  TrendingUp,
  ArrowUpDown,
  Clock,
  AlertCircle,
  BarChart3,
  Eye,
  Plus,
} from 'lucide-react';
import { CategoryConfig, SeatRecord } from '../types/booking';
import { formatBaht } from './BookingCard';

interface DailyBookingStatusSectionProps {
  records: SeatRecord[];
  categories: CategoryConfig[];
  onSelectSeat?: (seat: SeatRecord) => void;
  onRequestAddTable?: () => void;
}

interface ParsedBookingDay {
  key: string; // 'YYYY-MM-DD' for valid dates, '__RAW__:...' for unparsed text, '__UNDATED__' for empty
  displayLabel: string; // e.g. '31 ต.ค. 2569'
  weekdayShort: string; // e.g. 'ส.'
  shortAxisLabel: string; // e.g. '31 ต.ค.'
  sortTimestamp: number; // ms epoch for chronological sort (-1 for raw, -2 for undated)
  isUndated: boolean;
  isToday: boolean;
}

interface DailySummaryBucket {
  day: ParsedBookingDay;
  seats: SeatRecord[];
  totalBooked: number;
  paidCount: number;
  unpaidCount: number;
  ticketCollectedCount: number;
  checkedInCount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  byCategory: Record<string, number>;
}

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

const THAI_WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const MONTH_NAME_MAP: Record<string, number> = {
  // Thai short & full
  'ม.ค.': 1,
  'ม.ค': 1,
  มค: 1,
  มกราคม: 1,
  'ก.พ.': 2,
  'ก.พ': 2,
  กพ: 2,
  กุมภาพันธ์: 2,
  'มี.ค.': 3,
  'มี.ค': 3,
  มีค: 3,
  มีนาคม: 3,
  'เม.ย.': 4,
  'เม.ย': 4,
  เมย: 4,
  เมษายน: 4,
  'พ.ค.': 5,
  'พ.ค': 5,
  พค: 5,
  พฤษภาคม: 5,
  'มิ.ย.': 6,
  'มิ.ย': 6,
  มิย: 6,
  มิถุนายน: 6,
  'ก.ค.': 7,
  'ก.ค': 7,
  กค: 7,
  กรกฎาคม: 7,
  'ส.ค.': 8,
  'ส.ค': 8,
  สค: 8,
  สิงหาคม: 8,
  'ก.ย.': 9,
  'ก.ย': 9,
  กย: 9,
  กันยายน: 9,
  'ต.ค.': 10,
  'ต.ค': 10,
  ตค: 10,
  ตุลาคม: 10,
  'พ.ย.': 11,
  'พ.ย': 11,
  พย: 11,
  พฤศจิกายน: 11,
  'ธ.ค.': 12,
  'ธ.ค': 12,
  ธค: 12,
  ธันวาคม: 12,
  // English short & full
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalizeYearToCE(rawYear: number): number {
  if (!Number.isFinite(rawYear)) return new Date().getFullYear();
  if (rawYear >= 2400) {
    return rawYear - 543; // Buddhist Era 4-digit (e.g. 2569 -> 2026)
  }
  if (rawYear >= 1900 && rawYear <= 2200) {
    return rawYear; // CE 4-digit
  }
  if (rawYear >= 0 && rawYear < 100) {
    // 2-digit Thai Buddhist year (e.g. 67, 68, 69 -> 2567..2569 -> 2024..2026)
    if (rawYear >= 55) {
      return 2500 + rawYear - 543;
    }
    return 2000 + rawYear;
  }
  return rawYear;
}

function buildValidParsedDay(ceYear: number, month: number, day: number): ParsedBookingDay | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(ceYear, month - 1, day);
  if (
    dt.getFullYear() !== ceYear ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }

  const now = new Date();
  const isToday =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();

  const yyyy = String(ceYear).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const beYear = ceYear + 543;
  const monthShort = THAI_MONTHS_SHORT[month - 1];
  const weekdayShort = THAI_WEEKDAYS_SHORT[dt.getDay()];

  return {
    key: `${yyyy}-${mm}-${dd}`,
    displayLabel: `${day} ${monthShort} ${beYear}`,
    weekdayShort,
    shortAxisLabel: `${day} ${monthShort}`,
    sortTimestamp: dt.getTime(),
    isUndated: false,
    isToday,
  };
}

export function parseBookingDay(rawDateStr?: string): ParsedBookingDay {
  const cleaned = String(rawDateStr || '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a') {
    return {
      key: '__UNDATED__',
      displayLabel: 'ไม่ระบุวันที่จอง / โอน',
      weekdayShort: '',
      shortAxisLabel: 'ไม่ระบุวัน',
      sortTimestamp: -2,
      isUndated: true,
      isToday: false,
    };
  }

  // 1. ISO style YYYY-MM-DD or YYYY/MM/DD (with optional time)
  const isoMatch = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = normalizeYearToCE(Number(isoMatch[1]));
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const built = buildValidParsedDay(year, month, day);
    if (built) return built;
  }

  // 2. D/M/YYYY or DD-MM-YY or DD.MM.YYYY (Thai / International standard)
  const dmyMatch = cleaned.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    let first = Number(dmyMatch[1]);
    let second = Number(dmyMatch[2]);
    const year = normalizeYearToCE(Number(dmyMatch[3]));
    // Auto-swap if MM/DD/YYYY (e.g. 10/31/2026)
    if (first <= 12 && second > 12) {
      const tmp = first;
      first = second;
      second = tmp;
    }
    const built = buildValidParsedDay(year, second, first);
    if (built) return built;
  }

  // 3. D/M without year (e.g. "05/11 18:30 น.")
  const dmOnlyMatch = cleaned.match(/^(\d{1,2})[-/](\d{1,2})(?:\s|$)/);
  if (dmOnlyMatch) {
    let first = Number(dmOnlyMatch[1]);
    let second = Number(dmOnlyMatch[2]);
    if (first <= 12 && second > 12) {
      const tmp = first;
      first = second;
      second = tmp;
    }
    const built = buildValidParsedDay(new Date().getFullYear(), second, first);
    if (built) return built;
  }

  // 4. Named month: "31 ต.ค. 2569", "5 พฤศจิกายน 69", "31 Oct 2026"
  const namedDmyMatch = cleaned.match(
    /(\d{1,2})\s+([ก-๙a-zA-Z.]+)\s+(\d{2,4})?/
  );
  if (namedDmyMatch) {
    const day = Number(namedDmyMatch[1]);
    const monthToken = namedDmyMatch[2].toLowerCase();
    const month = MONTH_NAME_MAP[monthToken];
    if (month) {
      const year = namedDmyMatch[3]
        ? normalizeYearToCE(Number(namedDmyMatch[3]))
        : new Date().getFullYear();
      const built = buildValidParsedDay(year, month, day);
      if (built) return built;
    }
  }

  // 5. Named month first: "Oct 31, 2026"
  const namedMdyMatch = cleaned.match(/([a-zA-Z.]+)\s+(\d{1,2}),?\s*(\d{2,4})?/);
  if (namedMdyMatch) {
    const month = MONTH_NAME_MAP[namedMdyMatch[1].toLowerCase()];
    const day = Number(namedMdyMatch[2]);
    if (month) {
      const year = namedMdyMatch[3]
        ? normalizeYearToCE(Number(namedMdyMatch[3]))
        : new Date().getFullYear();
      const built = buildValidParsedDay(year, month, day);
      if (built) return built;
    }
  }

  // 6. Fallback: strip trailing HH:MM time and group by cleaned date string
  const stripped = cleaned.replace(/\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*น\.?)?$/i, '').trim() || cleaned;
  return {
    key: `__RAW__:${stripped.toLowerCase()}`,
    displayLabel: stripped,
    weekdayShort: '',
    shortAxisLabel: stripped.length > 10 ? `${stripped.slice(0, 9)}…` : stripped,
    sortTimestamp: -1,
    isUndated: false,
    isToday: false,
  };
}

function formatPct(part: number, total: number): string {
  if (!total || total <= 0) return '0%';
  const raw = (part / total) * 100;
  const rounded = Math.round(raw * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export const DailyBookingStatusSection: React.FC<DailyBookingStatusSectionProps> = ({
  records,
  categories,
  onSelectSeat,
  onRequestAddTable,
}) => {
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [chartMode, setChartMode] = useState<'zone' | 'payment'>('zone');
  const [expandedDayKeys, setExpandedDayKeys] = useState<Record<string, boolean>>({});

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) {
      map[c.id] = c.colorHex;
    }
    return map;
  }, [categories]);

  const bookedRecordsInScope = useMemo(() => {
    return records.filter((r) => {
      if (!r.isBooked) return false;
      if (zoneFilter !== 'all' && r.categoryId !== zoneFilter) return false;
      return true;
    });
  }, [records, zoneFilter]);

  // Group booked records into daily buckets
  const dailyBuckets: DailySummaryBucket[] = useMemo(() => {
    const map = new Map<string, DailySummaryBucket>();

    for (const seat of bookedRecordsInScope) {
      const parsedDay = parseBookingDay(seat.transferDate);
      let bucket = map.get(parsedDay.key);
      if (!bucket) {
        bucket = {
          day: parsedDay,
          seats: [],
          totalBooked: 0,
          paidCount: 0,
          unpaidCount: 0,
          ticketCollectedCount: 0,
          checkedInCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          byCategory: {},
        };
        map.set(parsedDay.key, bucket);
      }

      bucket.seats.push(seat);
      bucket.totalBooked += 1;
      if (seat.isPaid) {
        bucket.paidCount += 1;
        bucket.paidAmount += seat.transferAmount || 0;
      } else {
        bucket.unpaidCount += 1;
        bucket.unpaidAmount += seat.transferAmount || 0;
      }
      if (seat.isTicketCollected) bucket.ticketCollectedCount += 1;
      if (seat.isCheckedIn) bucket.checkedInCount += 1;
      bucket.totalAmount += seat.transferAmount || 0;
      bucket.byCategory[seat.categoryId] = (bucket.byCategory[seat.categoryId] || 0) + 1;
    }

    const list = Array.from(map.values());
    list.sort((a, b) => {
      // Keep undated bucket always at the bottom for clean chronology
      if (a.day.isUndated && !b.day.isUndated) return 1;
      if (!a.day.isUndated && b.day.isUndated) return -1;
      if (a.day.sortTimestamp === -1 && b.day.sortTimestamp >= 0) return 1;
      if (b.day.sortTimestamp === -1 && a.day.sortTimestamp >= 0) return -1;
      if (a.day.sortTimestamp !== b.day.sortTimestamp) {
        return sortDirection === 'desc'
          ? b.day.sortTimestamp - a.day.sortTimestamp
          : a.day.sortTimestamp - b.day.sortTimestamp;
      }
      return a.day.displayLabel.localeCompare(b.day.displayLabel, 'th');
    });

    return list;
  }, [bookedRecordsInScope, sortDirection]);

  // Chronological (oldest -> newest) dated buckets for the bar chart
  const chartBuckets = useMemo(() => {
    const dated = dailyBuckets.filter((b) => !b.day.isUndated);
    const ordered = [...dated].sort((a, b) => {
      if (a.day.sortTimestamp !== b.day.sortTimestamp) {
        return a.day.sortTimestamp - b.day.sortTimestamp;
      }
      return a.day.displayLabel.localeCompare(b.day.displayLabel, 'th');
    });
    // Keep up to latest 18 days on chart so bars stay legible
    return ordered.slice(-18);
  }, [dailyBuckets]);

  const maxDailyCount = useMemo(
    () => Math.max(1, ...dailyBuckets.map((b) => b.totalBooked)),
    [dailyBuckets]
  );

  // Trend KPIs
  const dailyInsights = useMemo(() => {
    const datedBuckets = dailyBuckets.filter((b) => !b.day.isUndated);
    const undatedBucket = dailyBuckets.find((b) => b.day.isUndated) || null;
    const activeDaysCount = datedBuckets.length;

    let peakBucket: DailySummaryBucket | null = null;
    for (const b of datedBuckets) {
      if (!peakBucket || b.totalBooked > peakBucket.totalBooked) {
        peakBucket = b;
      }
    }

    const datedSeatsTotal = datedBuckets.reduce((sum, b) => sum + b.totalBooked, 0);
    const datedAmountTotal = datedBuckets.reduce((sum, b) => sum + b.totalAmount, 0);
    const avgSeatsPerDay =
      activeDaysCount > 0 ? Math.round((datedSeatsTotal / activeDaysCount) * 10) / 10 : 0;
    const avgAmountPerDay =
      activeDaysCount > 0 ? Math.round(datedAmountTotal / activeDaysCount) : 0;

    // Date span
    const sortedChrono = [...datedBuckets]
      .filter((b) => b.day.sortTimestamp >= 0)
      .sort((a, b) => a.day.sortTimestamp - b.day.sortTimestamp);
    const firstDateLabel = sortedChrono[0]?.day.displayLabel || null;
    const latestDateLabel = sortedChrono[sortedChrono.length - 1]?.day.displayLabel || null;

    return {
      activeDaysCount,
      peakBucket,
      undatedCount: undatedBucket?.totalBooked || 0,
      avgSeatsPerDay,
      avgAmountPerDay,
      firstDateLabel,
      latestDateLabel,
    };
  }, [dailyBuckets]);

  const grandTotals = useMemo(() => {
    const byCategory: Record<string, number> = {};
    let totalBooked = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let ticketCollectedCount = 0;
    let checkedInCount = 0;
    let totalAmount = 0;
    let paidAmount = 0;

    for (const b of dailyBuckets) {
      totalBooked += b.totalBooked;
      paidCount += b.paidCount;
      unpaidCount += b.unpaidCount;
      ticketCollectedCount += b.ticketCollectedCount;
      checkedInCount += b.checkedInCount;
      totalAmount += b.totalAmount;
      paidAmount += b.paidAmount;
      for (const [catId, cnt] of Object.entries(b.byCategory)) {
        byCategory[catId] = (byCategory[catId] || 0) + cnt;
      }
    }

    return {
      totalBooked,
      paidCount,
      unpaidCount,
      ticketCollectedCount,
      checkedInCount,
      totalAmount,
      paidAmount,
      byCategory,
    };
  }, [dailyBuckets]);

  const toggleExpandDay = (key: string) => {
    setExpandedDayKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBarClick = (key: string) => {
    setExpandedDayKeys((prev) => ({ ...prev, [key]: true }));
    const el = document.getElementById(`daily-booking-row-${encodeURIComponent(key)}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <section className="bg-white border-[3px] border-indigo-400 rounded-2xl overflow-hidden shadow-xs">
      {/* Header Bar */}
      <div className="px-5 sm:px-6 py-4 bg-indigo-50/80 border-b-2 border-indigo-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                สถานะการจองบัตรของแต่ละวัน (Daily Booking Status)
              </h2>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-indigo-600 text-white font-mono tabular-nums">
                {dailyInsights.activeDaysCount} วัน · {grandTotals.totalBooked} โต๊ะ
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              สรุปจำนวนโต๊ะที่จอง แยกตามโซน สถานะชำระเงิน การรับบัตร เช็คอิน และยอดโอนรายวันตามวันที่โอน/จอง (คลิกที่แต่ละวันเพื่อดูรายชื่อโต๊ะ)
            </p>
          </div>
        </div>

        {/* Zone Filter + Sort Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-white border-2 border-indigo-200 rounded-xl">
            <button
              type="button"
              onClick={() => setZoneFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                zoneFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ทุกโซน
            </button>
            {categories.map((cat) => {
              const active = zoneFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setZoneFilter(cat.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  style={{
                    backgroundColor: active ? cat.colorHex : 'transparent',
                    color: active ? '#FFFFFF' : '#475569',
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: active ? '#FFFFFF' : cat.colorHex }}
                  />
                  {cat.name}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() =>
              setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-800 bg-white hover:bg-slate-50 border-2 border-slate-300 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600" />
            {sortDirection === 'desc' ? 'ล่าสุดก่อน (ใหม่ → เก่า)' : 'วันแรกก่อน (เก่า → ใหม่)'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 sm:p-6 space-y-6">
        {grandTotals.totalBooked === 0 ? (
          <div className="py-12 px-4 text-center bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl space-y-3">
            <Calendar className="w-10 h-10 text-slate-400 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800">
                ยังไม่มีข้อมูลการจองโต๊ะ{zoneFilter !== 'all' ? 'ในโซนที่เลือก' : 'ในระบบ'}
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                เมื่อเพิ่มข้อมูลการจองและระบุวันที่โอน/วันที่จอง (คอลัมน์ E) ระบบจะสรุปสถานะการจองบัตรของแต่ละวันพร้อมกราฟและตารางแยกตามวันให้โดยอัตโนมัติ
              </p>
            </div>
            {onRequestAddTable && (
              <button
                type="button"
                onClick={onRequestAddTable}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-2xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                เพิ่มการจองโต๊ะใหม่
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 4 Quick Daily Trend KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="p-4 rounded-xl bg-slate-50 border-2 border-slate-200 space-y-1">
                <p className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                  จำนวนวันที่มีการจอง
                </p>
                <p className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
                  {dailyInsights.activeDaysCount.toLocaleString('th-TH')} วัน
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                  {dailyInsights.firstDateLabel && dailyInsights.latestDateLabel
                    ? dailyInsights.firstDateLabel === dailyInsights.latestDateLabel
                      ? `วันที่ ${dailyInsights.firstDateLabel}`
                      : `${dailyInsights.firstDateLabel} – ${dailyInsights.latestDateLabel}`
                    : 'ยังไม่มีรายการที่ระบุวันที่'}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50/70 border-2 border-emerald-200 space-y-1">
                <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  วันที่จองบัตรสูงสุด (Peak Day)
                </p>
                {dailyInsights.peakBucket ? (
                  <>
                    <p className="text-xl font-extrabold text-emerald-900 truncate">
                      {dailyInsights.peakBucket.day.displayLabel}
                    </p>
                    <p className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                      {dailyInsights.peakBucket.totalBooked} โต๊ะ ·{' '}
                      {formatBaht(dailyInsights.peakBucket.totalAmount)}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 pt-1">ยังไม่พบวันที่ระบุไว้</p>
                )}
              </div>

              <div className="p-4 rounded-xl bg-indigo-50/70 border-2 border-indigo-200 space-y-1">
                <p className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                  เฉลี่ยการจองต่อวัน
                </p>
                <p className="text-2xl font-extrabold font-mono tabular-nums text-indigo-800">
                  {dailyInsights.avgSeatsPerDay.toLocaleString('th-TH')} โต๊ะ/วัน
                </p>
                <p className="text-xs font-mono font-semibold text-indigo-700 tabular-nums">
                  ยอดเฉลี่ย {formatBaht(dailyInsights.avgAmountPerDay)} / วัน
                </p>
              </div>

              <div
                className={`p-4 rounded-xl border-2 space-y-1 ${
                  dailyInsights.undatedCount > 0
                    ? 'bg-amber-50/80 border-amber-300'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <p
                  className={`text-xs font-bold flex items-center gap-1.5 ${
                    dailyInsights.undatedCount > 0 ? 'text-amber-900' : 'text-slate-500'
                  }`}
                >
                  <Clock
                    className={`w-3.5 h-3.5 ${
                      dailyInsights.undatedCount > 0 ? 'text-amber-600' : 'text-slate-400'
                    }`}
                  />
                  ยังไม่ระบุวันที่โอน/จอง
                </p>
                <p
                  className={`text-2xl font-extrabold font-mono tabular-nums ${
                    dailyInsights.undatedCount > 0 ? 'text-amber-800' : 'text-slate-700'
                  }`}
                >
                  {dailyInsights.undatedCount.toLocaleString('th-TH')} โต๊ะ
                </p>
                <p className="text-[11px] text-slate-600">
                  {dailyInsights.undatedCount > 0
                    ? 'คลิกแถว "ไม่ระบุวันที่" ด้านล่างเพื่อกรอกวันที่เพิ่ม'
                    : 'ระบุวันที่ครบทุกโต๊ะที่จองแล้ว'}
                </p>
              </div>
            </div>

            {/* Interactive Stacked Daily Bar Chart */}
            {chartBuckets.length > 0 && (
              <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-indigo-600" />
                      กราฟยอดการจองบัตรรายวัน ({chartBuckets.length} วันล่าสุดที่มีการจอง)
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      คลิกที่แท่งกราฟเพื่อเปิดดูรายชื่อโต๊ะที่จองในวันนั้นทันที
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-white border border-slate-300 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setChartMode('zone')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        chartMode === 'zone'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      แยกสีตามโซน
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMode('payment')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                        chartMode === 'payment'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      แยกตามสถานะชำระเงิน
                    </button>
                  </div>
                </div>

                {/* Chart Bars */}
                <div className="overflow-x-auto pb-1">
                  <div className="min-w-[460px] flex items-end gap-2 sm:gap-3 h-44 pt-6 px-2 border-b-2 border-slate-300">
                    {chartBuckets.map((bucket) => {
                      const totalHeightPct = Math.max(
                        10,
                        Math.round((bucket.totalBooked / maxDailyCount) * 100)
                      );
                      const isExpanded = Boolean(expandedDayKeys[bucket.day.key]);

                      return (
                        <button
                          key={bucket.day.key}
                          type="button"
                          onClick={() => handleBarClick(bucket.day.key)}
                          title={`${bucket.day.displayLabel}: ${bucket.totalBooked} โต๊ะ (ชำระแล้ว ${bucket.paidCount}, รอชำระ ${bucket.unpaidCount}) · ${formatBaht(bucket.totalAmount)}`}
                          className="flex-1 min-w-[44px] h-full flex flex-col items-center justify-end gap-1.5 group cursor-pointer focus:outline-none"
                        >
                          <span className="text-[11px] font-mono font-extrabold text-slate-700 group-hover:text-indigo-700 tabular-nums">
                            {bucket.totalBooked}
                          </span>
                          <div
                            className={`w-full max-w-[44px] rounded-t-lg overflow-hidden flex flex-col-reverse border-2 transition-all ${
                              isExpanded
                                ? 'border-slate-900 ring-2 ring-indigo-300 scale-[1.03]'
                                : 'border-white/60 group-hover:border-slate-800'
                            }`}
                            style={{ height: `${totalHeightPct}%` }}
                          >
                            {chartMode === 'zone' ? (
                              categories.map((cat) => {
                                const count = bucket.byCategory[cat.id] || 0;
                                if (count <= 0) return null;
                                const segPct = (count / bucket.totalBooked) * 100;
                                return (
                                  <div
                                    key={cat.id}
                                    style={{
                                      height: `${segPct}%`,
                                      backgroundColor: cat.colorHex,
                                    }}
                                    className="w-full"
                                  />
                                );
                              })
                            ) : (
                              <>
                                {bucket.paidCount > 0 && (
                                  <div
                                    style={{
                                      height: `${(bucket.paidCount / bucket.totalBooked) * 100}%`,
                                    }}
                                    className="w-full bg-emerald-500"
                                  />
                                )}
                                {bucket.unpaidCount > 0 && (
                                  <div
                                    style={{
                                      height: `${(bucket.unpaidCount / bucket.totalBooked) * 100}%`,
                                    }}
                                    className="w-full bg-rose-500"
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* X-Axis Labels */}
                  <div className="min-w-[460px] flex items-start gap-2 sm:gap-3 pt-2 px-2">
                    {chartBuckets.map((bucket) => (
                      <div
                        key={bucket.day.key}
                        className="flex-1 min-w-[44px] text-center"
                      >
                        <p className="text-[10px] font-bold text-slate-700 truncate">
                          {bucket.day.shortAxisLabel}
                        </p>
                        {bucket.day.weekdayShort && (
                          <p className="text-[10px] text-slate-400">
                            {bucket.day.weekdayShort}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-bold text-slate-600">
                  {chartMode === 'zone' ? (
                    categories.map((cat) => (
                      <span key={cat.id} className="inline-flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-xs shrink-0"
                          style={{ backgroundColor: cat.colorHex }}
                        />
                        โซน {cat.name}
                      </span>
                    ))
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-emerald-700">
                        <span className="w-3 h-3 rounded-xs bg-emerald-500 shrink-0" />
                        ชำระแล้ว
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-rose-700">
                        <span className="w-3 h-3 rounded-xs bg-rose-500 shrink-0" />
                        ยังไม่ชำระ / รอยืนยัน
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Detailed Daily Breakdown Table */}
            <div className="overflow-x-auto border-2 border-slate-200 rounded-2xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-200 text-xs font-extrabold text-slate-700">
                    <th className="py-3 px-4 whitespace-nowrap">วันที่จอง / โอน</th>
                    <th className="py-3 px-3 whitespace-nowrap">ยอดจอง (โต๊ะ)</th>
                    <th className="py-3 px-3 whitespace-nowrap">แยกตามโซน</th>
                    <th className="py-3 px-3 whitespace-nowrap">สถานะชำระเงิน</th>
                    <th className="py-3 px-3 whitespace-nowrap">รับบัตรแล้ว</th>
                    <th className="py-3 px-3 whitespace-nowrap">เช็คอินแล้ว</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">ยอดโอนรวมประจำวัน</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                  {dailyBuckets.map((bucket) => {
                    const isExpanded = Boolean(expandedDayKeys[bucket.day.key]);
                    const sharePct = formatPct(bucket.totalBooked, grandTotals.totalBooked);
                    const barWidthPct = Math.round((bucket.totalBooked / maxDailyCount) * 100);

                    return (
                      <React.Fragment key={bucket.day.key}>
                        <tr
                          id={`daily-booking-row-${encodeURIComponent(bucket.day.key)}`}
                          onClick={() => toggleExpandDay(bucket.day.key)}
                          className={`cursor-pointer transition-colors ${
                            bucket.day.isUndated
                              ? 'bg-amber-50/50 hover:bg-amber-50'
                              : isExpanded
                                ? 'bg-indigo-50/70'
                                : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          {/* Date Column */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {bucket.day.isUndated ? (
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                              ) : (
                                <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
                              )}
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`font-extrabold ${
                                      bucket.day.isUndated
                                        ? 'text-amber-900'
                                        : 'text-slate-900'
                                    }`}
                                  >
                                    {bucket.day.weekdayShort ? `${bucket.day.weekdayShort} ` : ''}
                                    {bucket.day.displayLabel}
                                  </span>
                                  {bucket.day.isToday && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-indigo-600 text-white">
                                      วันนี้
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Booked Count + Mini Progress */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <div className="space-y-1 min-w-[100px]">
                              <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                                <span className="text-base font-extrabold text-slate-900">
                                  {bucket.totalBooked}
                                </span>
                                <span className="text-[11px] font-semibold text-slate-500">
                                  โต๊ะ ({sharePct})
                                </span>
                              </div>
                              <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-600 rounded-full"
                                  style={{ width: `${barWidthPct}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Zone Breakdown Badges */}
                          <td className="py-3.5 px-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {categories.map((cat) => {
                                const cnt = bucket.byCategory[cat.id] || 0;
                                if (cnt === 0) return null;
                                return (
                                  <span
                                    key={cat.id}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold text-white font-mono tabular-nums"
                                    style={{ backgroundColor: cat.colorHex }}
                                  >
                                    {cat.name}: {cnt}
                                  </span>
                                );
                              })}
                            </div>
                          </td>

                          {/* Payment Status */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {bucket.paidCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono tabular-nums">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  ชำระแล้ว {bucket.paidCount}
                                </span>
                              )}
                              {bucket.unpaidCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-200 font-mono tabular-nums">
                                  <XCircle className="w-3 h-3 text-rose-600" />
                                  รอชำระ {bucket.unpaidCount}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Ticket Collected */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-violet-100 text-violet-800 border border-violet-200 font-mono tabular-nums">
                              <Ticket className="w-3 h-3 text-violet-600" />
                              {bucket.ticketCollectedCount} / {bucket.totalBooked}
                            </span>
                          </td>

                          {/* Checked In */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200 font-mono tabular-nums">
                              <UserCheck className="w-3 h-3 text-sky-600" />
                              {bucket.checkedInCount} / {bucket.totalBooked}
                            </span>
                          </td>

                          {/* Daily Revenue */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <p className="text-sm font-extrabold font-mono tabular-nums text-slate-900">
                              {formatBaht(bucket.totalAmount)}
                            </p>
                            {bucket.unpaidAmount > 0 ? (
                              <p className="text-[11px] font-mono tabular-nums text-emerald-700 font-semibold">
                                ชำระแล้ว {formatBaht(bucket.paidAmount)}
                              </p>
                            ) : (
                              bucket.totalAmount > 0 && (
                                <p className="text-[11px] font-semibold text-emerald-600">
                                  ชำระครบ 100%
                                </p>
                              )
                            )}
                          </td>

                          {/* Expand Toggle */}
                          <td className="py-3.5 px-3 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200">
                              {isExpanded ? (
                                <>
                                  ซ่อน
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </>
                              ) : (
                                <>
                                  ดูโต๊ะ ({bucket.totalBooked})
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </>
                              )}
                            </span>
                          </td>
                        </tr>

                        {/* Expanded Detail Panel: List all tables booked on this day */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90">
                            <td colSpan={8} className="p-4 border-t border-indigo-100">
                              <div className="space-y-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-xs font-extrabold text-slate-700">
                                    รายชื่อโต๊ะที่จองในวันที่ {bucket.day.displayLabel} (
                                    {bucket.seats.length} โต๊ะ — คลิกที่การ์ดเพื่อดูรายละเอียด / แก้ไข / ย้ายโต๊ะ)
                                  </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                  {bucket.seats.map((seat) => {
                                    const zoneColor =
                                      categoryColorMap[seat.categoryId] || '#2563EB';
                                    return (
                                      <button
                                        key={seat.id}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onSelectSeat?.(seat);
                                        }}
                                        className="text-left p-3 rounded-xl bg-white border-2 border-slate-200 hover:border-indigo-500 transition-all shadow-2xs flex flex-col justify-between gap-2 cursor-pointer"
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span
                                              className="px-2 py-0.5 rounded-md text-xs font-mono font-extrabold text-white shrink-0"
                                              style={{ backgroundColor: zoneColor }}
                                            >
                                              {seat.tableNumber}
                                            </span>
                                            <div className="min-w-0">
                                              <p className="text-xs font-bold text-slate-900 truncate">
                                                {seat.fullName || 'จองแล้ว (ไม่ระบุชื่อ)'}
                                              </p>
                                              <p className="text-[11px] font-mono text-slate-500 truncate">
                                                {seat.phone || 'ไม่ระบุเบอร์'} ·{' '}
                                                {seat.transferDate || 'ไม่ระบุวันที่'}
                                              </p>
                                            </div>
                                          </div>

                                          <span className="text-xs font-mono font-extrabold text-slate-800 shrink-0 tabular-nums">
                                            {formatBaht(
                                              seat.transferAmount,
                                              seat.rawTransferAmount
                                            )}
                                          </span>
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
                                          <div className="flex flex-wrap items-center gap-1">
                                            <span
                                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                seat.isPaid
                                                  ? 'bg-emerald-100 text-emerald-800'
                                                  : 'bg-rose-100 text-rose-700'
                                              }`}
                                            >
                                              {seat.isPaid ? 'ชำระแล้ว' : 'รอชำระ'}
                                            </span>
                                            {seat.isTicketCollected && (
                                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-800">
                                                รับบัตรแล้ว
                                              </span>
                                            )}
                                            {seat.isCheckedIn && (
                                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
                                                เช็คอินแล้ว
                                              </span>
                                            )}
                                          </div>
                                          {onSelectSeat && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600">
                                              <Eye className="w-3 h-3" />
                                              จัดการโต๊ะ
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>

                {/* Grand Total Footer Row */}
                <tfoot>
                  <tr className="bg-slate-900 text-white text-xs sm:text-sm font-extrabold">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      รวมทั้งหมด ({dailyBuckets.length} กลุ่มวัน)
                    </td>
                    <td className="py-3.5 px-3 font-mono tabular-nums whitespace-nowrap">
                      {grandTotals.totalBooked.toLocaleString('th-TH')} โต๊ะ (100%)
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {categories.map((cat) => {
                          const cnt = grandTotals.byCategory[cat.id] || 0;
                          if (cnt === 0) return null;
                          return (
                            <span
                              key={cat.id}
                              className="px-2 py-0.5 rounded text-[11px] font-mono tabular-nums text-white"
                              style={{ backgroundColor: cat.colorHex }}
                            >
                              {cat.name}: {cnt}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 font-mono tabular-nums whitespace-nowrap">
                      <span className="text-emerald-300">ชำระแล้ว {grandTotals.paidCount}</span>
                      {' · '}
                      <span className="text-rose-300">รอชำระ {grandTotals.unpaidCount}</span>
                    </td>
                    <td className="py-3.5 px-3 font-mono tabular-nums text-violet-200 whitespace-nowrap">
                      {grandTotals.ticketCollectedCount} / {grandTotals.totalBooked}
                    </td>
                    <td className="py-3.5 px-3 font-mono tabular-nums text-sky-200 whitespace-nowrap">
                      {grandTotals.checkedInCount} / {grandTotals.totalBooked}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <div>{formatBaht(grandTotals.totalAmount)}</div>
                      <div className="text-[11px] text-emerald-300 font-semibold">
                        ชำระแล้ว {formatBaht(grandTotals.paidAmount)}
                      </div>
                    </td>
                    <td className="py-3.5 px-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
