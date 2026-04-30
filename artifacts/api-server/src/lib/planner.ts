import { addDays, format, getDay, startOfMonth, endOfMonth, startOfDay, eachDayOfInterval, parseISO, isAfter } from "date-fns";

export type ShiftCodeRecord = {
  code: string;
  hours: number;
  type: string;
};

export type DayCodePreference = { day: number; code: string };

export type EmployeeRecord = {
  id: number;
  name: string;
  country: string;
  contractPercent: number;
  weeklyContractHours: number;
  homeworkEligible: boolean;
  coworkEligible: boolean;
  allowedShiftCodes: string[];
  permanenceGroup: number | null;
  permanenceLevel: number | null;
  isSpoc: boolean;
  spocRotates: boolean;
  isManagement: boolean;
  prmCounter: number;
  homeworkDaysUsedThisYear: number;
  dayCodePreferences: DayCodePreference[];
  prefersHeightAdjustableDesk: boolean;
  preferredOfficeId: number | null;
  onsiteWeekRatio: number | null;
};

export type OfficeRecord = {
  id: number;
  deskCount: number;
  deskCodes: string[];
  heightAdjustableDesks: string[];
  employeeIds: number[];
};

export type WeekTemplateRecord = {
  id: number;
  employeeId: number;
  days: Array<{ dayOfWeek: number; shiftCode: string | null }>;
};

export type RequestedDayOff = {
  employeeId: number;
  dates: string[];
};

export type PlanningEntryInput = {
  employeeId: number;
  date: string;
  shiftCode: string | null;
  deskCode: string | null;
  isPermanence: boolean;
  permanenceLevel: number | null;
  isLocked: boolean;
  requestedOff: boolean;
};

export type PlanningViolation = {
  date: string;
  type: string;
  message: string;
  employeeId: number | null;
};

const HOMEWORK_DAY_LIMIT = 35;
const MIN_ONSITE_RATIO = 0.5; // hard floor used only for violation checks

function getWorkingDays(year: number, month: number, publicHolidayDates: string[]): string[] {
  const start = startOfMonth(new Date(year, month - 1));
  const end = endOfMonth(new Date(year, month - 1));
  const blockedSet = new Set(publicHolidayDates);
  return eachDayOfInterval({ start, end })
    .filter((d) => {
      const dow = getDay(d);
      const iso = format(d, "yyyy-MM-dd");
      return dow !== 0 && dow !== 6 && !blockedSet.has(iso);
    })
    .map((d) => format(d, "yyyy-MM-dd"));
}

function getDayOfWeek0Mon(dateStr: string): number {
  const d = parseISO(dateStr);
  const dow = getDay(d);
  return dow === 0 ? 6 : dow - 1;
}

function getWeekNumber(dateStr: string): string {
  const d = parseISO(dateStr);
  const monday = addDays(d, -(getDayOfWeek0Mon(dateStr)));
  return format(monday, "yyyy-MM-dd");
}

/** Shuffle an array in-place using Fisher-Yates. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick the code of a given type whose hours is closest to targetHours.
 * Among equal distance, prefer higher hours (to avoid falling short).
 */
function bestCodeByTarget(
  type: "onsite" | "homework" | "cowork",
  allowed: string[],
  shiftCodes: Record<string, ShiftCodeRecord>,
  targetHours: number
): string | null {
  const candidates = allowed
    .filter((c) => shiftCodes[c]?.type === type)
    .map((c) => ({ code: c, hours: shiftCodes[c].hours }));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.hours - targetHours);
    const db = Math.abs(b.hours - targetHours);
    if (Math.abs(da - db) > 0.001) return da - db;
    // On equal distance: prefer the code that stays at or below target to avoid overshoot
    const aOver = a.hours > targetHours;
    const bOver = b.hours > targetHours;
    if (aOver && !bOver) return 1;
    if (!aOver && bOver) return -1;
    return b.hours - a.hours; // both same side: prefer higher
  });

  return candidates[0].code;
}

function hoursForCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): number {
  if (!code) return 0;
  return shiftCodes[code]?.hours ?? 0;
}


function isOnsiteCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): boolean {
  if (!code) return false;
  return shiftCodes[code]?.type === "onsite";
}

function isHomeworkCode(code: string | null, shiftCodes: Record<string, ShiftCodeRecord>): boolean {
  if (!code) return false;
  return shiftCodes[code]?.type === "homework";
}

/**
 * Assign JL (free day) slots to each employee for a given number of days.
 * Spreads evenly across the month (load-balanced) with random tiebreaking.
 */
function distributeJlDays(
  employees: EmployeeRecord[],
  workingDays: string[],
  jlDays: number
): Record<number, Set<string>> {
  const jlAssignments: Record<number, Set<string>> = {};
  const jlCountByDate: Record<string, number> = {};
  for (const d of workingDays) jlCountByDate[d] = 0;

  for (const emp of employees) {
    jlAssignments[emp.id] = new Set();
    if (jlDays <= 0 || workingDays.length === 0) continue;

    // Prefer placing pre-assigned JL on weekdays the employee already wants as JL.
    // This way the monthly JL "merges" into a preference-JL slot rather than adding
    // an extra JL on a neutral day (which would cause unnecessary PRM undershoot).
    const jlPrefWeekdays = new Set(
      (emp.dayCodePreferences ?? [])
        .filter((p) => p.code === "JL")
        .map((p) => p.day)
    );
    const preferredJlWorkingDays = workingDays.filter((d) => jlPrefWeekdays.has(getDayOfWeek0Mon(d)));
    const otherWorkingDays = workingDays.filter((d) => !jlPrefWeekdays.has(getDayOfWeek0Mon(d)));

    // Within each tier, shuffle then stable-sort by load
    const shuffledPref = shuffle([...preferredJlWorkingDays]);
    shuffledPref.sort((a, b) => (jlCountByDate[a] ?? 0) - (jlCountByDate[b] ?? 0));
    const shuffledOther = shuffle([...otherWorkingDays]);
    shuffledOther.sort((a, b) => (jlCountByDate[a] ?? 0) - (jlCountByDate[b] ?? 0));

    const prioritized = [...shuffledPref, ...shuffledOther];
    const count = Math.min(jlDays, workingDays.length);
    const picked = prioritized.slice(0, count);
    for (const d of picked) {
      jlAssignments[emp.id].add(d);
      jlCountByDate[d] = (jlCountByDate[d] ?? 0) + 1;
    }
  }

  return jlAssignments;
}

/**
 * Pre-compute which shift days should become JL substitutions for an employee.
 *
 * Priority order:
 *   1. Days whose weekday has an explicit JL preference (user wants free days here).
 *   2. Days with NO code preference and not in avoidWeekdays (neutral days).
 *   3. Days in avoidWeekdays (has a non-JL preference) — last resort, sorted by
 *      highest expected hours first so we sacrifice the fewest preference-days.
 */
function pickJlSubstitutionDates(
  candidateShiftDays: string[],
  neededJL: number,
  preferredWeekdays: number[],
  avoidWeekdays: Set<number> = new Set(),
  expectedHoursForDate: (d: string) => number = () => 8
): string[] {
  if (neededJL <= 0 || candidateShiftDays.length === 0) return [];
  const n = Math.min(neededJL, candidateShiftDays.length - 1);

  const preferredSet = new Set(preferredWeekdays);

  // Tier 1: explicit JL preference weekdays
  const tier1 = shuffle(candidateShiftDays.filter((d) => preferredSet.has(getDayOfWeek0Mon(d))));
  // Tier 2: neutral days (no preference, not asked to avoid)
  const tier2 = shuffle(
    candidateShiftDays.filter((d) => !preferredSet.has(getDayOfWeek0Mon(d)) && !avoidWeekdays.has(getDayOfWeek0Mon(d)))
  );
  // Tier 3: days with a code preference — pick highest-hour days first to preserve low-hour preference days
  const tier3 = candidateShiftDays
    .filter((d) => !preferredSet.has(getDayOfWeek0Mon(d)) && avoidWeekdays.has(getDayOfWeek0Mon(d)))
    .sort((a, b) => expectedHoursForDate(b) - expectedHoursForDate(a));

  const result: string[] = [];
  for (const d of [...tier1, ...tier2, ...tier3]) {
    if (result.length >= n) break;
    result.push(d);
  }
  return result;
}

/**
 * Assign one location-type per ISO week so employees stay in the same place all week.
 *
 * Default distribution (when remote options exist, no custom ratio):
 *   4 weeks → 2 onsite  5 weeks → 2  6 weeks → 3  7 weeks → 3
 *   Formula: floor(n * 0.5)
 *
 * When `onsiteWeekRatio` is set on an employee (0.0–1.0), that ratio is used instead.
 * Employees who cannot work remotely at all are always fully onsite regardless.
 */
function predetermineWeeklyTypes(
  weekKeys: string[],
  canHomework: boolean,
  canCowork: boolean,
  onsiteWeekRatio?: number | null
): Record<string, "onsite" | "homework" | "cowork"> {
  if (weekKeys.length === 0) return {};

  const numWeeks = weekKeys.length;
  const hasRemote = canHomework || canCowork;

  // Use the employee's custom ratio when provided; otherwise the standard 50% floor formula.
  const ratio = (onsiteWeekRatio != null) ? onsiteWeekRatio : 0.5;
  const targetOnsiteWeeks = hasRemote
    ? Math.floor(numWeeks * ratio)
    : numWeeks;
  // Remaining weeks go to homework and/or cowork (40% target for eligible employees)
  const remaining = numWeeks - targetOnsiteWeeks;

  let homeworkWeeks = 0;
  let coworkWeeks = 0;
  if (remaining > 0) {
    if (canHomework && canCowork) {
      homeworkWeeks = Math.ceil(remaining / 2);
      coworkWeeks = remaining - homeworkWeeks;
    } else if (canHomework) {
      homeworkWeeks = remaining;
    } else if (canCowork) {
      coworkWeeks = remaining;
    }
  }

  const weekTypes: Array<"onsite" | "homework" | "cowork"> = [
    ...Array<"onsite">(targetOnsiteWeeks).fill("onsite"),
    ...Array<"homework">(homeworkWeeks).fill("homework"),
    ...Array<"cowork">(coworkWeeks).fill("cowork"),
  ];
  const shuffledTypes = shuffle(weekTypes);

  const result: Record<string, "onsite" | "homework" | "cowork"> = {};
  weekKeys.forEach((wk, i) => { result[wk] = shuffledTypes[i] ?? "onsite"; });
  return result;
}

export function generatePlanning(params: {
  year: number;
  month: number;
  employees: EmployeeRecord[];
  offices: OfficeRecord[];
  shiftCodes: Record<string, ShiftCodeRecord>;
  templates: WeekTemplateRecord[];
  publicHolidayDates: string[];
  jlDays: number;
  contractualHours: number;
  requestedDaysOff: RequestedDayOff[];
  lockedEntries?: PlanningEntryInput[];
  /**
   * Pre-computed permanence assignments keyed by ISO week-start date string (Monday, "yyyy-MM-dd").
   * When provided, the planner uses these instead of computing its own month-relative rotation.
   * This ensures the planner is consistent with the Permanence page (ISO week numbers + manual overrides).
   */
  permanenceAssignments?: Record<string, { g1: number | null; g2: number | null }>;
  /**
   * SPOC rotation assignments keyed by ISO week-start date.
   * Maps weekStart → employeeId of the SPOC assigned to the rotation office that week.
   */
  spocRotationAssignments?: Record<string, number | null>;
  /**
   * The office ID that SPOC rotation employees should be sent to during their rotation week.
   */
  spocRotationOfficeId?: number | null;
  /**
   * Per-employee count of JL days that were already planned in the previous month's overflow
   * entries for this month's initial partial-week days.  Used to reduce the JL substitution
   * budget so the planner doesn't generate more JL days than needed.
   */
  prevMonthOverflowJlCountByEmployee?: Record<number, number>;
}): { entries: PlanningEntryInput[]; violations: PlanningViolation[] } {
  const {
    year,
    month,
    employees,
    offices,
    shiftCodes,
    publicHolidayDates,
    jlDays,
    contractualHours,
    requestedDaysOff,
    lockedEntries = [],
    prevMonthOverflowJlCountByEmployee = {},
    permanenceAssignments: externalPermanenceAssignments,
    spocRotationAssignments = {},
    spocRotationOfficeId,
  } = params;

  // Build a set of locked slots: "employeeId-date" — these are skipped during generation
  // and included in the output as-is so the caller can deduplicate with DB state.
  const lockedSlots = new Set(lockedEntries.map((e) => `${e.employeeId}-${e.date}`));

  const workingDays = getWorkingDays(year, month, publicHolidayDates);

  // Only auto-plan working days that belong to complete ISO weeks — weeks whose Monday
  // falls within this month. Days at the start of the month that complete a week started
  // in the previous month are left blank (no auto-planning entry generated for them).
  const monthStartStr = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

  // Overflow: days in the NEXT month that complete the last week of this month.
  // E.g. if this month ends on Thursday, the Friday of that same week (in the next month)
  // is an overflow day — planned now so it's visible when viewing the next month.
  const monthEndDate = endOfMonth(new Date(year, month - 1));
  const monthEndStr = format(monthEndDate, "yyyy-MM-dd");
  const lastWeekFriday = addDays(parseISO(getWeekNumber(monthEndStr)), 4); // Mon of last week + 4 = Fri
  const overflowCalendarDays: string[] = [];
  const overflowWorkingDays: string[] = [];
  if (isAfter(lastWeekFriday, monthEndDate)) {
    // Start at midnight so the loop boundary comparison is consistent with lastWeekFriday
    // which is also midnight (from parseISO on a date-only string). Without this, endOfMonth()
    // gives T23:59:59.999 which propagates through addDays and makes the last overflow day
    // appear "after" lastWeekFriday (T00:00:00), causing it to be silently skipped.
    let d = addDays(startOfDay(monthEndDate), 1);
    while (!isAfter(d, lastWeekFriday)) {
      const dayStr = format(d, "yyyy-MM-dd");
      overflowCalendarDays.push(dayStr);
      const dow = getDay(d);
      if (dow !== 0 && dow !== 6 && !publicHolidayDates.includes(dayStr)) {
        overflowWorkingDays.push(dayStr);
      }
      d = addDays(d, 1);
    }
  }

  // This month's working days in complete weeks — used for JL/hours budgeting.
  // Overflow days (from the next month) are intentionally excluded so JL substitution
  // is not inflated by extra days that fall outside this month's contractual target.
  const thisMonthPlanningDays = workingDays.filter((d) => getWeekNumber(d) >= monthStartStr);

  // All planned working days: this month's full weeks + overflow into the next month.
  // Used for desk tracking, violation checks, and the day-by-day generation loop.
  const fullWeekWorkingDays = [...thisMonthPlanningDays, ...overflowWorkingDays];
  const fullWeekWorkingDaySet = new Set(fullWeekWorkingDays);
  const overflowWorkingDaySet = new Set(overflowWorkingDays);

  const allDays = [
    ...eachDayOfInterval({
      start: startOfMonth(new Date(year, month - 1)),
      end: endOfMonth(new Date(year, month - 1)),
    }).map((d) => format(d, "yyyy-MM-dd")),
    ...overflowCalendarDays,
  ];

  const requestedOffMap: Record<number, Set<string>> = {};
  for (const r of requestedDaysOff) {
    requestedOffMap[r.employeeId] = new Set(r.dates);
  }

  // Permanence rotation — 1 employee per group per week, no level distinction.
  // If the caller provides pre-computed assignments (from the permanence page logic with
  // ISO week numbers + manual overrides) we use those; otherwise fall back to internal rotation.
  const permanenceGroup1 = employees.filter((e) => e.permanenceGroup === 1);
  const permanenceGroup2 = employees.filter((e) => e.permanenceGroup === 2);

  const weekStarts = [...new Set(fullWeekWorkingDays.map(getWeekNumber))];
  let permanenceAssignments: Record<string, { g1: number | null; g2: number | null }>;

  if (externalPermanenceAssignments) {
    permanenceAssignments = externalPermanenceAssignments;
  } else {
    permanenceAssignments = {};
    function rotateAssign(group: EmployeeRecord[], weekIdx: number): number | null {
      if (group.length === 0) return null;
      return group[weekIdx % group.length].id;
    }
    weekStarts.forEach((ws, idx) => {
      permanenceAssignments[ws] = {
        g1: rotateAssign(permanenceGroup1, idx),
        g2: rotateAssign(permanenceGroup2, idx),
      };
    });
  }

  // ── Satellite office detection & multi-office rotation ─────────────────────
  // A satellite office is one that has at least one SPOC member assigned to it, but
  // is NOT the primary SPOC office (the office where exclusively-SPOC employees live).
  // Example: Wiltz has Boris + Nanz (SPOC) + Dirk (non-SPOC). It is a satellite because
  // none of its employees are SPOC-only (Dirk is not SPOC; Boris/Nanz also belong to SPOC).
  const primarySpocOffice = offices.find((o) =>
    o.employeeIds.some((empId) => {
      const emp = employees.find((e) => e.id === empId);
      return emp?.isSpoc && offices.filter((o2) => o2.employeeIds.includes(empId)).length === 1;
    })
  );

  const satelliteOffices: OfficeRecord[] = primarySpocOffice
    ? offices.filter(
        (o) =>
          o.id !== primarySpocOffice.id &&
          o.employeeIds.some((empId) => employees.find((e) => e.id === empId)?.isSpoc)
      )
    : [];

  // For each satellite, rotate multi-office employees between offices week by week,
  // staggered by employee index so colleagues cover different offices the same week.
  const weeklyPreferredOffice: Record<number, Record<string, number>> = {};

  for (const satOffice of satelliteOffices) {
    const satMultiEmps = employees
      .filter((emp) => {
        const empOfficeIds = offices.filter((o) => o.employeeIds.includes(emp.id)).map((o) => o.id);
        return empOfficeIds.includes(satOffice.id) && empOfficeIds.length > 1;
      })
      .sort((a, b) => a.id - b.id); // deterministic order → deterministic offsets

    satMultiEmps.forEach((emp, empIdx) => {
      // SPOC rotation employees are handled separately below — skip satellite cycling
      // for them so they stay at their preferred office except in their designated week.
      if (emp.spocRotates) return;
      const empOfficeList = offices.filter((o) => o.employeeIds.includes(emp.id));
      if (!weeklyPreferredOffice[emp.id]) weeklyPreferredOffice[emp.id] = {};
      weekStarts.forEach((wk, wkIdx) => {
        // Offset by empIdx: colleague A goes to SPOC while B goes to Wiltz, then swap
        const preferredIdx = (wkIdx + empIdx) % empOfficeList.length;
        weeklyPreferredOffice[emp.id][wk] = empOfficeList[preferredIdx].id;
      });
    });
  }

  // ── SPOC rotation: override preferred office for the designated SPOC each week ──
  // When a SPOC is assigned to the rotation office for a given week AND the planner
  // assigns them an onsite day, their desk is reserved at the rotation office instead
  // of their normal office. Homework/cowork weeks are not changed.
  if (spocRotationOfficeId) {
    for (const [wk, empId] of Object.entries(spocRotationAssignments)) {
      if (empId == null) continue;
      if (!weeklyPreferredOffice[empId]) weeklyPreferredOffice[empId] = {};
      // Only set if this week is in scope for this month
      if (weekStarts.includes(wk)) {
        weeklyPreferredOffice[empId][wk] = spocRotationOfficeId;
      }
    }
  }

  // JL day assignment (pre-configured from monthly config)
  // Use only this month's days — overflow days are never JL.
  const jlAssignments = distributeJlDays(employees, thisMonthPlanningDays, jlDays);

  // Per-employee contractual hours (scaled by contract %) with PRM counter compensation
  const empContractualHours: Record<number, number> = {};
  const empBaseContractualHours: Record<number, number> = {};
  for (const emp of employees) {
    const pct = emp.contractPercent ?? 100;
    const base = Math.round(contractualHours * (pct / 100) * 10) / 10;
    empBaseContractualHours[emp.id] = base;
    // Adjust monthly target by PRM counter to trend it back towards 0
    // If prmCounter > 0 (overpaid hours), plan fewer hours this month; if < 0, plan more
    const prm = emp.prmCounter ?? 0;
    const clampedPrm = Math.max(-10, Math.min(10, prm));
    empContractualHours[emp.id] = Math.round(Math.max(0, base - clampedPrm) * 10) / 10;
  }

  // ── PHASE 1: Pre-determine day types + JL substitutions per employee ───────
  // Each ISO week gets a single location type (onsite/homework/cowork) so employees
  // stay at the same place all week. JL substitutions are spread randomly.

  const empDayTypeMap: Record<number, Record<string, "onsite" | "homework" | "cowork">> = {};
  const empShiftDays: Record<number, string[]> = {};
  const jlSubstitutionDates: Record<number, Set<string>> = {};

  for (const emp of employees) {
    const jlDates = jlAssignments[emp.id] ?? new Set();
    const reqOffDates = requestedOffMap[emp.id] ?? new Set();

    // Candidate shift days for JL/hours budgeting = this month's full-week days only.
    // Overflow days are excluded here so the JL substitution formula is not inflated.
    const candidateShiftDays = thisMonthPlanningDays.filter((d) => !jlDates.has(d) && !reqOffDates.has(d));
    // Overflow days always become shift days — they are never JL-substituted.
    const overflowCandidateDays = overflowWorkingDays.filter((d) => !reqOffDates.has(d));

    // Compute how many JL substitutions are needed.
    // Strategy: use the full-time equivalent daily hours (contractualHours / workingDays) as
    // the reference for the "typical shift length". This ensures part-time employees receive
    // full-length shifts on fewer days (the rest become JL), rather than getting many half-days.
    const empTarget = empContractualHours[emp.id];
    const regularCodes = emp.allowedShiftCodes.filter((c) => c !== "JL" && c !== "C0");
    const regularHours = regularCodes.map((c) => shiftCodes[c]?.hours ?? 0).filter((h) => h > 0);

    // Full-time reference: what daily hours would a 100% employee get?
    const fteDaily = candidateShiftDays.length > 0 ? contractualHours / candidateShiftDays.length : 8;
    // Typical shift = the code hours closest to the full-time daily reference
    const typicalShiftHours = regularHours.length > 0
      ? regularHours.reduce((best, h) => Math.abs(h - fteDaily) <= Math.abs(best - fteDaily) ? h : best, regularHours[0])
      : null;

    // Helper: expected hours for a candidate shift day.
    // When multiple preferences exist for the same weekday, uses their average so that
    // the neededJL calculation correctly accounts for the rotation across all codes.
    const getExpectedHours = (dateStr: string): number => {
      const dow = getDayOfWeek0Mon(dateStr);
      const uniquePrefs = (emp.dayCodePreferences ?? [])
        .filter((p) => p.day === dow && p.code !== "JL" && p.code !== "C0" && emp.allowedShiftCodes.includes(p.code))
        .filter((p, idx, arr) => arr.findIndex((q) => q.code === p.code) === idx);
      if (uniquePrefs.length === 0) return typicalShiftHours ?? 8;
      const avg = uniquePrefs.reduce((s, p) => s + (shiftCodes[p.code]?.hours ?? 0), 0) / uniquePrefs.length;
      return avg;
    };

    // Preference-weighted total: sum of expected hours if all candidate days were shift days
    const totalExpectedIfAllShift = candidateShiftDays.reduce((s, d) => s + getExpectedHours(d), 0);
    // Average expected hours per shift day (accounts for short-hour preference codes like TT4)
    const weightedAvgHours = candidateShiftDays.length > 0
      ? totalExpectedIfAllShift / candidateShiftDays.length
      : (typicalShiftHours ?? 8);

    // Derive preferred JL weekdays from day code preferences (entries where code === "JL")
    const jlPreferredWeekdays = (emp.dayCodePreferences ?? [])
      .filter((p) => p.code === "JL")
      .map((p) => p.day);

    // Weekdays that have a non-JL/non-C0 code preference — protect from JL selection
    const avoidJlWeekdays = new Set(
      (emp.dayCodePreferences ?? [])
        .filter((p) => p.code !== "JL" && p.code !== "C0" && emp.allowedShiftCodes.includes(p.code))
        .map((p) => p.day)
    );

    // ── JL count calculation ─────────────────────────────────────────────────
    // Two independent constraints; we take the maximum (most JL days) of both:
    //
    // 1. Contract-proportional: an N% employee should work N% of available shift
    //    days — the rest become JL. This is the primary driver for part-time
    //    employees where full-week hours might be < monthly target.
    //    e.g. Marc 80%, 13 candidate days → ceil(13 × 0.2) = 3 JL days.
    //
    // 2. Hours-based: when working every candidate day would overshoot the target,
    //    convert enough shift days to JL to stay within the budget.
    //    e.g. Dirk V 100%, 9h codes, 22 days, 176h target →
    //         ceil(22 − 176/9) = ceil(2.44) = 3 JL days.
    const contractRatio = (emp.contractPercent ?? 100) / 100;
    const proportionalJL = Math.ceil(candidateShiftDays.length * (1 - contractRatio));

    let hoursJL = 0;
    if (weightedAvgHours > 0 && totalExpectedIfAllShift > empTarget) {
      hoursJL = Math.ceil(candidateShiftDays.length - empTarget / weightedAvgHours);
    }

    let neededJL = Math.max(proportionalJL, hoursJL);

    // Reduce by JL days already planned in the previous month's overflow entries
    // (the initial partial-week days of this month that were planned last month).
    neededJL = Math.max(0, neededJL - (prevMonthOverflowJlCountByEmployee[emp.id] ?? 0));

    // Guarantee ALL preferred-JL weekdays become JL — day preferences take priority over
    // the hours calculation. Any resulting hour shortfall is absorbed by the PRM counter.
    if (jlPreferredWeekdays.length > 0) {
      const preferredJLdaysCount = candidateShiftDays.filter(
        (d) => jlPreferredWeekdays.includes(getDayOfWeek0Mon(d))
      ).length;
      neededJL = Math.max(neededJL, preferredJLdaysCount);
    }

    const subDates = pickJlSubstitutionDates(candidateShiftDays, neededJL, jlPreferredWeekdays, avoidJlWeekdays, getExpectedHours);
    jlSubstitutionDates[emp.id] = new Set(subDates);

    // Overflow days respect JL weekday preferences — if the employee prefers JL on a given
    // weekday and an overflow day falls on that weekday, it also becomes a JL substitution.
    for (const d of overflowCandidateDays) {
      const dow = getDayOfWeek0Mon(d);
      if (jlPreferredWeekdays.includes(dow)) {
        jlSubstitutionDates[emp.id].add(d);
      }
    }

    // Actual shift days: this month's candidate days minus JL, plus overflow days minus JL-preference days
    const shiftDays = [
      ...candidateShiftDays.filter((d) => !jlSubstitutionDates[emp.id].has(d)),
      ...overflowCandidateDays.filter((d) => !jlSubstitutionDates[emp.id].has(d)),
    ];
    empShiftDays[emp.id] = shiftDays;

    const canHomework =
      emp.homeworkEligible &&
      emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "homework") &&
      (emp.homeworkDaysUsedThisYear ?? 0) < HOMEWORK_DAY_LIMIT;
    const canCowork =
      emp.coworkEligible && emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "cowork");

    // Group shift days by ISO week and assign one type per week
    const shiftDaysByWeek: Record<string, string[]> = {};
    for (const day of shiftDays) {
      const wk = getWeekNumber(day);
      if (!shiftDaysByWeek[wk]) shiftDaysByWeek[wk] = [];
      shiftDaysByWeek[wk].push(day);
    }
    const weekTypeMap = predetermineWeeklyTypes(
      Object.keys(shiftDaysByWeek),
      canHomework,
      canCowork,
      (emp as { onsiteWeekRatio?: number | null }).onsiteWeekRatio
    );

    // Force "onsite" for any week where this employee is the designated permanence person.
    // This ensures the planner never generates a cowork/homework week that violates permanence duty.
    for (const wk of Object.keys(weekTypeMap)) {
      const pa = permanenceAssignments[wk];
      if (pa && (pa.g1 === emp.id || pa.g2 === emp.id)) {
        weekTypeMap[wk] = "onsite";
      }
    }

    // Build day → type lookup
    empDayTypeMap[emp.id] = {};
    for (const [wk, type] of Object.entries(weekTypeMap)) {
      for (const day of shiftDaysByWeek[wk] ?? []) {
        empDayTypeMap[emp.id][day] = type;
      }
    }

  }

  // ── PHASE 2: Day-by-day assignment ────────────────────────────────────────
  // Track desk pool per ISO-week per office — only for employees onsite the whole week.
  const allWeekKeys = [...new Set(allDays.map(getWeekNumber))];
  const deskUsedByWeekByOffice: Record<string, Record<number, Set<string>>> = {};
  for (const wk of allWeekKeys) {
    deskUsedByWeekByOffice[wk] = {};
    for (const o of offices) deskUsedByWeekByOffice[wk][o.id] = new Set();
  }
  // Per-day desk pool for partial-week onsite employees (day-pref override within a homework/cowork week).
  // These desks are only blocked for that specific day — not the whole week.
  const deskUsedByDateByOffice: Record<string, Record<number, Set<string>>> = {};
  // Per-employee per-week desk assignment (undefined = not yet assigned this week)
  const weeklyDeskByEmp: Record<number, Record<string, string | null>> = {};
  for (const e of employees) weeklyDeskByEmp[e.id] = {};

  // Pre-populate desk pool from locked entries so other employees' reserved desks are
  // respected when regenerating a single employee. Without this, the regen algorithm
  // might assign a desk that is already occupied by a locked (unchanged) colleague.
  for (const locked of lockedEntries) {
    if (!locked.deskCode) continue;
    const weekStart = getWeekNumber(locked.date);
    const empOffices = offices.filter((o) => o.employeeIds.includes(locked.employeeId));
    for (const office of empOffices) {
      if (office.deskCodes.includes(locked.deskCode)) {
        (deskUsedByWeekByOffice[weekStart] ??= {})[office.id] ??= new Set();
        deskUsedByWeekByOffice[weekStart][office.id].add(locked.deskCode);
        // Only set weeklyDeskByEmp once per employee per week (first locked day encountered)
        if (weeklyDeskByEmp[locked.employeeId]?.[weekStart] === undefined) {
          weeklyDeskByEmp[locked.employeeId][weekStart] = locked.deskCode;
        }
        break;
      }
    }
  }

  // Running balance for hour accuracy
  const remainingHours: Record<number, number> = {};
  const remainingShiftDays: Record<number, number> = {};
  for (const emp of employees) {
    remainingHours[emp.id] = empContractualHours[emp.id];
    // Exclude overflow days from the shift-day count so hour distribution is based
    // entirely on this month's working days, matching the contractual hours target.
    remainingShiftDays[emp.id] = empShiftDays[emp.id].filter((d) => !overflowWorkingDaySet.has(d)).length;
  }

  // Round-robin rotation index per employee per day-of-week.
  // Advances each time a shift day (non-JL, non-C0) is processed, so preferences
  // cycle evenly: e.g. [X80, TT8] on Monday → X80, TT8, X80, TT8 …
  const dayPrefRotation: Record<number, Record<number, number>> = {};
  for (const emp of employees) dayPrefRotation[emp.id] = {};

  const homeworkCountThisMonth: Record<number, number> = {};
  const plannedHoursByEmployee: Record<number, number> = {};
  const onsiteCountByEmployee: Record<number, number> = {};
  // Days with a homework OR cowork code — used as denominator for the 50% onsite check
  // (C0 holidays, JL leave, etc. are intentionally excluded from this ratio)
  const nonOnsiteWorkCountByEmployee: Record<number, number> = {};
  for (const e of employees) {
    homeworkCountThisMonth[e.id] = 0;
    plannedHoursByEmployee[e.id] = 0;
    onsiteCountByEmployee[e.id] = 0;
    nonOnsiteWorkCountByEmployee[e.id] = 0;
  }

  const entries: PlanningEntryInput[] = [];

  for (const dateStr of allDays) {
    const dayOfWeek = getDayOfWeek0Mon(dateStr);
    const weekStart = getWeekNumber(dateStr);
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isPublicHoliday = publicHolidayDates.includes(dateStr);

    for (const emp of employees) {
      if (isWeekend || isPublicHoliday) continue;

      // Skip days in partial weeks at the start of the month (completing a week from the
      // previous month). These days are intentionally left unplanned by the auto-planner.
      if (!fullWeekWorkingDaySet.has(dateStr)) continue;

      // Skip slots that have been manually locked — they already exist in the DB and are
      // preserved by the route (we only delete non-locked entries before inserting new ones).
      if (lockedSlots.has(`${emp.id}-${dateStr}`)) {
        // Still count the locked entry's hours so violation checks are accurate
        const locked = lockedEntries.find((e) => e.employeeId === emp.id && e.date === dateStr);
        const isLockedOverflow = overflowWorkingDaySet.has(dateStr);
        if (locked?.shiftCode) {
          const h = hoursForCode(locked.shiftCode, shiftCodes);
          plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + h;
          if (!isLockedOverflow) remainingHours[emp.id] = (remainingHours[emp.id] ?? 0) - h;
          const lockedType = shiftCodes[locked.shiftCode]?.type;
          if (lockedType === "onsite") {
            onsiteCountByEmployee[emp.id] = (onsiteCountByEmployee[emp.id] ?? 0) + 1;
          } else if (lockedType === "homework" || lockedType === "cowork") {
            nonOnsiteWorkCountByEmployee[emp.id] = (nonOnsiteWorkCountByEmployee[emp.id] ?? 0) + 1;
          }
        }
        if (!isLockedOverflow) {
          remainingShiftDays[emp.id] = Math.max(0, (remainingShiftDays[emp.id] ?? 1) - 1);
        }
        continue;
      }

      const permaInfo = permanenceAssignments[weekStart];
      const isPermanence = permaInfo?.g1 === emp.id || permaInfo?.g2 === emp.id;
      const permanenceLevel = null; // Level distinction removed

      // Requested day off → C0
      if ((requestedOffMap[emp.id] ?? new Set()).has(dateStr)) {
        const holidayHours = hoursForCode("C0", shiftCodes);
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "C0",
          deskCode: null,
          isPermanence: false,
          permanenceLevel: null,
          isLocked: true,
          requestedOff: true,
        });
        plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + holidayHours;
        remainingHours[emp.id] = (remainingHours[emp.id] ?? 0) - holidayHours;
        continue;
      }

      // Pre-assigned JL day (from monthly config)
      if ((jlAssignments[emp.id] ?? new Set()).has(dateStr) && emp.allowedShiftCodes.includes("JL")) {
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "JL",
          deskCode: null,
          isPermanence: false,
          permanenceLevel: null,
          isLocked: false,
          requestedOff: false,
        });
        continue;
      }

      // JL substitution day (pre-computed in Phase 1 to avoid hour overshoot)
      if (jlSubstitutionDates[emp.id]?.has(dateStr)) {
        entries.push({
          employeeId: emp.id,
          date: dateStr,
          shiftCode: "JL",
          deskCode: null,
          isPermanence: false,
          permanenceLevel: null,
          isLocked: false,
          requestedOff: false,
        });
        continue;
      }

      // Running-balance daily target.
      // Overflow days use a fixed rate (base monthly hours ÷ this month's shift days) so they
      // don't draw from the contractual budget, keeping this month's hour total accurate.
      const isOverflowDay = overflowWorkingDaySet.has(dateStr);
      const thisMonthShiftCount = empShiftDays[emp.id].filter((d) => !overflowWorkingDaySet.has(d)).length;
      const shiftDaysLeft = Math.max(1, remainingShiftDays[emp.id] ?? 1);
      const dailyTarget = isOverflowDay
        ? (empBaseContractualHours[emp.id] / Math.max(1, thisMonthShiftCount))
        : (remainingHours[emp.id] ?? 0) / shiftDaysLeft;

      // Get pre-determined type for this week (weekly grouping)
      let preferredType: "onsite" | "homework" | "cowork" =
        empDayTypeMap[emp.id]?.[dateStr] ?? "onsite";

      // Flag: this employee is on permanence duty this week — they must be onsite every shift day.
      const weekPermanence = permanenceAssignments[weekStart];
      const isOnPermanenceDuty = weekPermanence?.g1 === emp.id || weekPermanence?.g2 === emp.id;

      // Day-of-week code preference: rotate round-robin through the effective preference
      // pool for this weekday. Deduplicate by code first.
      //
      // Two cases:
      //   • Single-type weekday preference (e.g. Bassst always TT9 on Thursday, Nanz always
      //     TT on Thursday): all preferences for this weekday share one location type.
      //     → Honour them as explicit per-day overrides; they will override the pre-determined
      //       week type below so the employee genuinely works from that location on that day.
      //
      //   • Mixed-type weekday preference (e.g. Monday listed with both X80 onsite AND TT8
      //     homework): the round-robin would randomly assign different types on the same
      //     weekday across weeks, causing days within a week to have different location types.
      //     → Filter to only the codes whose type matches the pre-determined week type, so
      //       the week stays grouped. If none match, fall back to the full list.
      const allDayPrefs = (emp.dayCodePreferences ?? [])
        .filter((p) => p.day === dayOfWeek && p.code !== "JL" && p.code !== "C0" && emp.allowedShiftCodes.includes(p.code))
        .filter((p, idx, arr) => arr.findIndex((q) => q.code === p.code) === idx);

      const prefTypeSet = new Set(
        allDayPrefs.map((p) => shiftCodes[p.code]?.type).filter(Boolean)
      );
      const hasMixedPrefTypes = prefTypeSet.size > 1;

      // For mixed preferences, keep only those matching the pre-determined week type
      const weekTypeFiltered = hasMixedPrefTypes
        ? allDayPrefs.filter((p) => shiftCodes[p.code]?.type === preferredType)
        : allDayPrefs;
      const effectivePrefs = weekTypeFiltered.length > 0 ? weekTypeFiltered : allDayPrefs;

      let dayPrefCode: string | null = null;
      if (effectivePrefs.length > 0) {
        const rotIdx = dayPrefRotation[emp.id][dayOfWeek] ?? 0;
        dayPrefCode = effectivePrefs[rotIdx % effectivePrefs.length].code;
        dayPrefRotation[emp.id][dayOfWeek] = rotIdx + 1;
      }
      const dayPrefCodeValid = dayPrefCode !== null;
      const dayPrefType = dayPrefCodeValid ? (shiftCodes[dayPrefCode!]?.type as "onsite" | "homework" | "cowork" | undefined) ?? null : null;

      // Single-type explicit day preferences override the week type for this specific day.
      // This honours Bassst's TT9 on Thursday, Nanz's TT on Thursday, Ben2's TT on
      // Monday/Wednesday, etc. — regardless of what the pre-determined week type is.
      // Mixed-type preferences have already been filtered above so they won't flip the type.
      if (dayPrefType === "onsite" || dayPrefType === "homework" || dayPrefType === "cowork") {
        preferredType = dayPrefType;
      }

      // Permanence duty does NOT force onsite — the employee's normal week type
      // and day preferences still apply even when on permanence duty.

      // Find which office(s) this employee belongs to, reordered so the
      // preferred office comes first. Priority: employee's explicit preferred office
      // → satellite rotation preferred office → rest.
      const empOfficesFull = offices.filter((o) => o.employeeIds.includes(emp.id));
      const rotationPreferredOfficeId = weeklyPreferredOffice[emp.id]?.[weekStart];
      // Rotation office always overrides the employee's normal preferred office
      const effectivePreferredOfficeId = rotationPreferredOfficeId ?? emp.preferredOfficeId;
      const empOffices = effectivePreferredOfficeId
        ? [
            ...empOfficesFull.filter((o) => o.id === effectivePreferredOfficeId),
            ...empOfficesFull.filter((o) => o.id !== effectivePreferredOfficeId),
          ]
        : empOfficesFull;
      let assignedDeskCode: string | null = null;
      let deskAvailableFromPool = false;

      // Desk assignment strategy depends on the week type:
      //   • Onsite week  → same desk all week, blocked in weekly pool (current behaviour).
      //   • Homework/cowork week with an onsite day-pref override today
      //                  → pick desk from daily pool for today only; desk freed tomorrow.
      //   • Homework/cowork week, today remote → no desk reserved.
      // `preferredType` is already resolved (day-pref overrides applied above).
      const weekTypeInitial = empDayTypeMap[emp.id]?.[dateStr] ?? "onsite";
      const isFullOnsiteWeek = weekTypeInitial === "onsite";

      // Helper: pick a desk from an available list respecting HA preference
      const pickDesk = (available: string[], haDesks: string[]): string => {
        if (emp.prefersHeightAdjustableDesk) {
          const ha = available.filter((dc) => haDesks.includes(dc));
          const pool = ha.length > 0 ? ha : available;
          return pool[Math.floor(Math.random() * pool.length)];
        }
        const nonHa = available.filter((dc) => !haDesks.includes(dc));
        const pool = nonHa.length > 0 ? nonHa : available;
        return pool[Math.floor(Math.random() * pool.length)];
      };

      if (empOffices.length > 0) {
        if (isFullOnsiteWeek) {
          // ── Full-week onsite: same desk all week (weekly pool) ──────────────
          const existingWeekDesk = weeklyDeskByEmp[emp.id]?.[weekStart];
          if (existingWeekDesk !== undefined) {
            assignedDeskCode = existingWeekDesk;
            deskAvailableFromPool = assignedDeskCode !== null;
          } else {
            for (const office of empOffices) {
              const weekUsed = deskUsedByWeekByOffice[weekStart]?.[office.id] ?? new Set();
              const allAvailable = office.deskCodes.filter((dc) => !weekUsed.has(dc));
              if (allAvailable.length > 0) {
                deskAvailableFromPool = true;
                assignedDeskCode = pickDesk(allAvailable, office.heightAdjustableDesks ?? []);
                (deskUsedByWeekByOffice[weekStart] ??= {})[office.id] ??= new Set();
                deskUsedByWeekByOffice[weekStart][office.id].add(assignedDeskCode);
                weeklyDeskByEmp[emp.id][weekStart] = assignedDeskCode;
                break;
              }
            }
            if (!deskAvailableFromPool) {
              weeklyDeskByEmp[emp.id][weekStart] = null;
            }
          }
        } else if (preferredType === "onsite") {
          // ── Partial-week: onsite today only (day-pref override) ─────────────
          // Don't block the desk for the whole week — pick from the daily pool.
          // Desks already taken by full-week-onsite colleagues (weekly pool) are excluded.
          for (const office of empOffices) {
            const weekUsed = deskUsedByWeekByOffice[weekStart]?.[office.id] ?? new Set();
            const dayUsed = (deskUsedByDateByOffice[dateStr] ??= {})[office.id] ?? new Set();
            const allAvailable = office.deskCodes.filter((dc) => !weekUsed.has(dc) && !dayUsed.has(dc));
            if (allAvailable.length > 0) {
              deskAvailableFromPool = true;
              assignedDeskCode = pickDesk(allAvailable, office.heightAdjustableDesks ?? []);
              (deskUsedByDateByOffice[dateStr] ??= {})[office.id] ??= new Set();
              deskUsedByDateByOffice[dateStr][office.id].add(assignedDeskCode);
              break;
            }
          }
          // No weekly-pool entry for partial-week employees — each onsite day is independent.
          if (weeklyDeskByEmp[emp.id]?.[weekStart] === undefined) {
            weeklyDeskByEmp[emp.id][weekStart] = null;
          }
        } else {
          // Remote day (homework / cowork) — no desk needed
          if (weeklyDeskByEmp[emp.id]?.[weekStart] === undefined) {
            weeklyDeskByEmp[emp.id][weekStart] = null;
          }
        }
      }

      // If employee has no office or no desk available for today, they cannot go onsite
      const canGoOnsite = empOffices.length > 0 && deskAvailableFromPool;

      const homeworkUsedSoFar = (emp.homeworkDaysUsedThisYear ?? 0) + (homeworkCountThisMonth[emp.id] ?? 0);
      const canHomework = emp.homeworkEligible &&
        emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "homework") &&
        homeworkUsedSoFar < HOMEWORK_DAY_LIMIT;
      const canCowork = emp.coworkEligible &&
        emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "cowork");

      // Enforce preferred type, with fallback if constraints prevent it
      let chosenCode: string | null = null;
      let actualDeskCode: string | null = null;

      // An explicit day preference overrides eligibility flags (homeworkEligible /
      // coworkEligible). The employee or manager deliberately set this code for
      // this weekday, so we honour it as long as the code is in allowedShiftCodes
      // and the homework-day annual limit is not exceeded.
      const dayPrefForcesHomework =
        dayPrefCodeValid &&
        dayPrefType === "homework" &&
        emp.allowedShiftCodes.includes(dayPrefCode!) &&
        homeworkUsedSoFar < HOMEWORK_DAY_LIMIT;
      const dayPrefForcesCowork =
        dayPrefCodeValid &&
        dayPrefType === "cowork" &&
        emp.allowedShiftCodes.includes(dayPrefCode!);

      // Helper: pick code for a type, using day preference first if it matches
      const pickCode = (type: "onsite" | "homework" | "cowork"): string | null => {
        if (dayPrefCodeValid && dayPrefType === type) return dayPrefCode;
        return bestCodeByTarget(type, emp.allowedShiftCodes, shiftCodes, dailyTarget);
      };

      if (preferredType === "onsite") {
        if (canGoOnsite) {
          chosenCode = pickCode("onsite");
          actualDeskCode = assignedDeskCode;
        } else {
          if (canHomework) {
            chosenCode = pickCode("homework");
          } else if (canCowork) {
            chosenCode = pickCode("cowork");
          } else {
            chosenCode = pickCode("onsite");
          }
        }
      } else if (preferredType === "homework") {
        if (canHomework || dayPrefForcesHomework) {
          chosenCode = pickCode("homework");
        } else if (canGoOnsite) {
          chosenCode = pickCode("onsite");
          actualDeskCode = assignedDeskCode;
        } else if (canCowork) {
          chosenCode = pickCode("cowork");
        }
      } else {
        if (canCowork || dayPrefForcesCowork) {
          chosenCode = pickCode("cowork");
        } else if (canGoOnsite) {
          chosenCode = pickCode("onsite");
          actualDeskCode = assignedDeskCode;
        } else if (canHomework) {
          chosenCode = pickCode("homework");
        }
      }

      const assignedHours = hoursForCode(chosenCode, shiftCodes);

      const chosenType = chosenCode ? shiftCodes[chosenCode]?.type : undefined;
      if (chosenType === "onsite") {
        onsiteCountByEmployee[emp.id] = (onsiteCountByEmployee[emp.id] ?? 0) + 1;
      } else if (chosenType === "homework") {
        homeworkCountThisMonth[emp.id] = (homeworkCountThisMonth[emp.id] ?? 0) + 1;
        nonOnsiteWorkCountByEmployee[emp.id] = (nonOnsiteWorkCountByEmployee[emp.id] ?? 0) + 1;
      } else if (chosenType === "cowork") {
        nonOnsiteWorkCountByEmployee[emp.id] = (nonOnsiteWorkCountByEmployee[emp.id] ?? 0) + 1;
      }

      plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + assignedHours;
      // Overflow days don't consume this month's hour/day budget
      if (!isOverflowDay) {
        remainingHours[emp.id] = (remainingHours[emp.id] ?? 0) - assignedHours;
        remainingShiftDays[emp.id] = Math.max(0, (remainingShiftDays[emp.id] ?? 0) - 1);
      }

      entries.push({
        employeeId: emp.id,
        date: dateStr,
        shiftCode: chosenCode,
        deskCode: actualDeskCode,
        isPermanence: isPermanence,
        permanenceLevel,
        isLocked: false,
        requestedOff: false,
      });
    }
  }

  // ── PHASE 3: Second pass — promote homework to onsite where a desk is free ──
  // For each homework entry, if a desk is available in the daily pool (not taken by a
  // full-week onsite employee or another partial-week employee already assigned today),
  // upgrade the entry to onsite. Cowork is never touched. Days with an explicit homework
  // day-code preference are also left unchanged (user intent).
  for (const emp of employees) {
    if (!emp.allowedShiftCodes.some((c) => shiftCodes[c]?.type === "onsite")) continue;

    const shiftDaysForEmp = empShiftDays[emp.id] ?? [];
    const empTarget = empContractualHours[emp.id];
    const thisMonthShiftCountP3 = shiftDaysForEmp.filter((d) => !overflowWorkingDaySet.has(d)).length;
    const dailyTarget = thisMonthShiftCountP3 > 0 ? empTarget / thisMonthShiftCountP3 : 8;
    const onsiteCode = bestCodeByTarget("onsite", emp.allowedShiftCodes, shiftCodes, dailyTarget);
    if (!onsiteCode) continue;

    const empOfficesFull = offices.filter((o) => o.employeeIds.includes(emp.id));

    for (const entry of entries) {
      if (entry.employeeId !== emp.id || entry.isLocked || entry.requestedOff) continue;
      if (!entry.shiftCode) continue;

      const currentType = shiftCodes[entry.shiftCode]?.type;
      // Only promote homework → onsite. Cowork is intentional (external coworking site).
      if (currentType !== "homework") continue;

      // Never promote a day that was pre-planned as a homework week in Phase 1.
      // Phase 1 deliberately assigned this week as homework to hit the 50% onsite ratio.
      // Promoting it would bypass that ratio, especially when the employee has a second
      // office (e.g. a co-work space) that always has free desks.
      if (empDayTypeMap[emp.id]?.[entry.date] === "homework") continue;

      // Respect explicit homework day preferences — don't override the employee's intent.
      const dow = getDayOfWeek0Mon(entry.date);
      const hasExplicitRemotePref = (emp.dayCodePreferences ?? []).some(
        (p) =>
          p.day === dow &&
          emp.allowedShiftCodes.includes(p.code) &&
          (shiftCodes[p.code]?.type === "homework" || shiftCodes[p.code]?.type === "cowork")
      );
      if (hasExplicitRemotePref) continue;

      // Try to find a free desk for this specific day.
      // Desks taken all week by full-onsite colleagues (weeklyPool) are unavailable;
      // desks already assigned today by other partial-week employees (dailyPool) are also unavailable.
      const wk = getWeekNumber(entry.date);
      const rotationPreferredOfficeId = weeklyPreferredOffice[emp.id]?.[wk];
      // Rotation office always overrides the employee's normal preferred office
      const effectivePreferredOfficeId = rotationPreferredOfficeId ?? emp.preferredOfficeId;
      const empOfficesOrdered = effectivePreferredOfficeId
        ? [
            ...empOfficesFull.filter((o) => o.id === effectivePreferredOfficeId),
            ...empOfficesFull.filter((o) => o.id !== effectivePreferredOfficeId),
          ]
        : empOfficesFull;

      let promotedDesk: string | null = null;
      for (const office of empOfficesOrdered) {
        const weekUsed = deskUsedByWeekByOffice[wk]?.[office.id] ?? new Set();
        const dayUsed = (deskUsedByDateByOffice[entry.date] ??= {})[office.id] ?? new Set();
        const allAvailable = office.deskCodes.filter((dc) => !weekUsed.has(dc) && !dayUsed.has(dc));
        if (allAvailable.length > 0) {
          const haDesks = office.heightAdjustableDesks ?? [];
          if (emp.prefersHeightAdjustableDesk) {
            const ha = allAvailable.filter((dc) => haDesks.includes(dc));
            const pool = ha.length > 0 ? ha : allAvailable;
            promotedDesk = pool[Math.floor(Math.random() * pool.length)];
          } else {
            const nonHa = allAvailable.filter((dc) => !haDesks.includes(dc));
            const pool = nonHa.length > 0 ? nonHa : allAvailable;
            promotedDesk = pool[Math.floor(Math.random() * pool.length)];
          }
          (deskUsedByDateByOffice[entry.date] ??= {})[office.id] ??= new Set();
          deskUsedByDateByOffice[entry.date][office.id].add(promotedDesk);
          break;
        }
      }

      if (!promotedDesk) continue; // No desk available today — leave as homework

      // Upgrade entry to onsite with the daily desk
      const oldHours = hoursForCode(entry.shiftCode, shiftCodes);
      const newHours = hoursForCode(onsiteCode, shiftCodes);
      entry.shiftCode = onsiteCode;
      entry.deskCode = promotedDesk;
      onsiteCountByEmployee[emp.id] = (onsiteCountByEmployee[emp.id] ?? 0) + 1;
      homeworkCountThisMonth[emp.id] = Math.max(0, (homeworkCountThisMonth[emp.id] ?? 0) - 1);
      nonOnsiteWorkCountByEmployee[emp.id] = Math.max(0, (nonOnsiteWorkCountByEmployee[emp.id] ?? 0) - 1);
      plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) + (newHours - oldHours);
    }
  }

  // ── PHASE 4: Hour-correction pass ───────────────────────────────────────────
  // For employees whose planned hours still exceed their contractual target by more
  // than a small tolerance, substitute random non-locked shift days with JL until
  // the overshoot is within bounds.
  //
  // We count hours by month prefix (matching the frontend) rather than by the
  // overflow set.  This is critical for employees like Dirk (all 9h codes) whose
  // full-week hours are within target but whose same-month overflow days (e.g.
  // Mar 30–31 in the March plan, date prefix "2026-03-") push the total over.
  const HOUR_OVERSHOOT_TOLERANCE = 4; // hours — roughly half an 8h day
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;

  for (const emp of employees) {
    const target = empBaseContractualHours[emp.id] ?? contractualHours;

    // Mirror exactly what the frontend's getEmployeePlannedHours does:
    // count all non-JL entries whose date starts with this month's prefix.
    let plannedThisMonth = 0;
    for (const e of entries) {
      if (e.employeeId !== emp.id || !e.date.startsWith(monthPrefix)) continue;
      plannedThisMonth += hoursForCode(e.shiftCode, shiftCodes);
    }

    const overshoot = plannedThisMonth - target;
    if (overshoot <= HOUR_OVERSHOOT_TOLERANCE) continue;

    // Collect convertible entries: same month prefix, non-locked, real shift codes
    // (not JL/C0), not on permanence duty.
    // Prefer homework/cowork over onsite to protect the onsite ratio.
    const convertible = entries.filter(
      (e) =>
        e.employeeId === emp.id &&
        e.date.startsWith(monthPrefix) &&
        !e.isLocked &&
        e.shiftCode !== null &&
        e.shiftCode !== "JL" &&
        e.shiftCode !== "C0" &&
        !e.isPermanence
    );

    // Sort: homework/cowork first (less impact on onsite ratio), then random within each group
    const nonOnsite = shuffle(convertible.filter((e) => shiftCodes[e.shiftCode!]?.type !== "onsite"));
    const onsite = shuffle(convertible.filter((e) => shiftCodes[e.shiftCode!]?.type === "onsite"));
    const ordered = [...nonOnsite, ...onsite];

    let remaining = overshoot;
    for (const entry of ordered) {
      if (remaining <= HOUR_OVERSHOOT_TOLERANCE) break;
      const entryHours = hoursForCode(entry.shiftCode, shiftCodes);
      const idx = entries.indexOf(entry);
      if (idx === -1) continue;

      const wasOnsite = shiftCodes[entry.shiftCode!]?.type === "onsite";
      const wasNonOnsiteWork =
        shiftCodes[entry.shiftCode!]?.type === "homework" ||
        shiftCodes[entry.shiftCode!]?.type === "cowork";

      entries[idx] = {
        ...entries[idx],
        shiftCode: "JL",
        deskCode: null,
        isPermanence: false,
      };
      remaining -= entryHours;
      plannedHoursByEmployee[emp.id] = (plannedHoursByEmployee[emp.id] ?? 0) - entryHours;

      // Keep violation counters consistent
      if (wasOnsite) {
        onsiteCountByEmployee[emp.id] = Math.max(0, (onsiteCountByEmployee[emp.id] ?? 0) - 1);
      } else if (wasNonOnsiteWork) {
        nonOnsiteWorkCountByEmployee[emp.id] = Math.max(
          0,
          (nonOnsiteWorkCountByEmployee[emp.id] ?? 0) - 1
        );
      }
    }
  }

  // ── VIOLATIONS ─────────────────────────────────────────────────────────────
  const violations: PlanningViolation[] = [];

  // Combine generated entries with locked entries so that when a single employee is
  // regenerated all other employees' preserved plans are visible to violation checks.
  const allEntriesForViolations = [...entries, ...lockedEntries];

  for (const dateStr of fullWeekWorkingDays) {
    const dayEntries = allEntriesForViolations.filter((e) => e.date === dateStr);
    const onsiteSet = new Set(
      dayEntries.filter((e) => isOnsiteCode(e.shiftCode, shiftCodes)).map((e) => e.employeeId)
    );

    const spocPresent = employees.filter((e) => e.isSpoc).some((e) => onsiteSet.has(e.id));
    if (!spocPresent && employees.some((e) => e.isSpoc)) {
      violations.push({ date: dateStr, type: "missing_spoc", message: "No SPOC on-site", employeeId: null });
    }

    const mgmtPresent = employees.filter((e) => e.isManagement).some((e) => onsiteSet.has(e.id));
    if (!mgmtPresent && employees.some((e) => e.isManagement)) {
      violations.push({ date: dateStr, type: "missing_management", message: "No Management on-site", employeeId: null });
    }

    // Permanence check: at least one member of each group must be on-site.
    // This is a role/membership check — any G1 member on-site satisfies G1 coverage,
    // regardless of which individual is the "assigned" permanence person that week.
    const g1Members = employees.filter((e) => e.permanenceGroup === 1);
    const g2Members = employees.filter((e) => e.permanenceGroup === 2);

    if (g1Members.length > 0 && !g1Members.some((e) => onsiteSet.has(e.id))) {
      violations.push({ date: dateStr, type: "missing_perma1", message: "Permanence Group 1 not on-site", employeeId: null });
    }
    if (g2Members.length > 0 && !g2Members.some((e) => onsiteSet.has(e.id))) {
      violations.push({ date: dateStr, type: "missing_perma2", message: "Permanence Group 2 not on-site", employeeId: null });
    }
  }

  // ── Per-week satellite office coverage ──────────────────────────────────────
  // For each week, at least one employee assigned to a satellite office must be
  // onsite there (desk in that office). Locked entries count for coverage too.
  for (const wk of weekStarts) {
    const weekDaySet = new Set(fullWeekWorkingDays.filter((d) => getWeekNumber(d) === wk));
    for (const satOffice of satelliteOffices) {
      const hasOnsiteAtSatellite = allEntriesForViolations.some(
        (e) =>
          weekDaySet.has(e.date) &&
          satOffice.employeeIds.includes(e.employeeId) &&
          isOnsiteCode(e.shiftCode, shiftCodes) &&
          satOffice.deskCodes.includes(e.deskCode ?? "")
      );
      if (!hasOnsiteAtSatellite) {
        violations.push({
          date: wk,
          type: "missing_satellite_office",
          message: `No one onsite at satellite office (id ${satOffice.id}) week of ${wk}`,
          employeeId: null,
        });
      }
    }
  }

  for (const emp of employees) {
    const hwTotal = (emp.homeworkDaysUsedThisYear ?? 0) + (homeworkCountThisMonth[emp.id] ?? 0);
    if (hwTotal > HOMEWORK_DAY_LIMIT && (emp.country === "be" || emp.country === "de" || emp.country === "fr")) {
      violations.push({
        date: `${year}-${String(month).padStart(2, "0")}`,
        type: "homework_limit",
        message: `${emp.name}: homework days ${hwTotal}/${HOMEWORK_DAY_LIMIT} exceeded`,
        employeeId: emp.id,
      });
    }

    // Check 50% onsite minimum.
    // Denominator = onsite days + homework days + cowork days only.
    // Holidays (C0), JL leave, and other non-work codes are excluded so that
    // part-time employees and those with many leave days are not penalised unfairly.
    const onsiteCount = onsiteCountByEmployee[emp.id] ?? 0;
    const nonOnsiteWorkCount = nonOnsiteWorkCountByEmployee[emp.id] ?? 0;
    const workDaysForRatio = onsiteCount + nonOnsiteWorkCount;
    const requiredOnsite = emp.onsiteWeekRatio != null
      ? Math.ceil(workDaysForRatio * emp.onsiteWeekRatio)
      : Math.ceil(workDaysForRatio * MIN_ONSITE_RATIO);
    if (workDaysForRatio > 0 && onsiteCount < requiredOnsite) {
      violations.push({
        date: `${year}-${String(month).padStart(2, "0")}`,
        type: "insufficient_onsite",
        message: `${emp.name}: only ${onsiteCount}/${workDaysForRatio} work days onsite (min ${Math.round((emp.onsiteWeekRatio ?? MIN_ONSITE_RATIO) * 100)}%)`,
        employeeId: emp.id,
      });
    }
  }

  return { entries, violations };
}
