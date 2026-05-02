import { requireAdmin } from "../middleware/auth.js";
import { Router } from "express";
import writeXlsxFile from "write-excel-file/node";
import type { SheetData } from "write-excel-file/node";
import readXlsxFile from "read-excel-file/node";
import type { Sheet } from "read-excel-file/node";
import multer from "multer";
import { db } from "@workspace/db";
import {
  employeesTable,
  planningMonthsTable,
  planningEntriesTable,
  shiftCodesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const DESK_SUFFIX = " Desk";

// ── helpers ──────────────────────────────────────────────────────────────────

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function workingDatesForMonth(year: number, month: number): string[] {
  const dates: string[] = [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay(); // 0=Sun 6=Sat
    if (dow !== 0 && dow !== 6) dates.push(isoDate(year, month, d));
  }
  return dates;
}

/** Build 2D array of rows for a worksheet. */
function buildRows(
  dates: string[],
  employees: { id: number; name: string; displayOrder: number }[],
  entriesByEmpDate: Map<string, { shiftCode: string | null; deskCode: string | null }>
): SheetData {
  const rows: SheetData = [["Employee", ...dates]];

  const sorted = [...employees].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));

  for (const emp of sorted) {
    const shiftRow: (string | null)[] = [emp.name];
    const deskRow: (string | null)[] = [emp.name + DESK_SUFFIX];
    for (const date of dates) {
      const key = `${emp.id}::${date}`;
      const e = entriesByEmpDate.get(key);
      shiftRow.push(e?.shiftCode ?? null);
      deskRow.push(e?.deskCode ?? null);
    }
    rows.push(shiftRow);
    rows.push(deskRow);
  }

  return rows;
}

/** Build column width spec: first col 20, rest 10. */
function buildColumns(dateCount: number) {
  return [{ width: 20 }, ...Array<{ width: number }>(dateCount).fill({ width: 10 })];
}

// ── EXPORT ───────────────────────────────────────────────────────────────────

router.get("/planning/excel-export", requireAdmin, async (req, res): Promise<void> => {
  const year = parseInt(req.query.year as string, 10);
  const monthParam = req.query.month ? parseInt(req.query.month as string, 10) : null;

  if (!year || year < 2000 || year > 2100) {
    res.status(400).json({ error: "Invalid year" });
    return;
  }
  if (monthParam !== null && (monthParam < 1 || monthParam > 12)) {
    res.status(400).json({ error: "Invalid month" });
    return;
  }

  const employees = await db
    .select({ id: employeesTable.id, name: employeesTable.name, displayOrder: employeesTable.displayOrder })
    .from(employeesTable)
    .orderBy(employeesTable.displayOrder, employeesTable.name);

  let dates: string[];
  let sheetName: string;
  let rowData: SheetData;

  if (monthParam) {
    // ── Single month: one sheet ───────────────────────────────────────────────
    const [pm] = await db
      .select()
      .from(planningMonthsTable)
      .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, monthParam)));

    const entriesByEmpDate = new Map<string, { shiftCode: string | null; deskCode: string | null }>();
    if (pm) {
      const entries = await db
        .select()
        .from(planningEntriesTable)
        .where(eq(planningEntriesTable.planningMonthId, pm.id));
      for (const e of entries) {
        entriesByEmpDate.set(`${e.employeeId}::${e.date}`, {
          shiftCode: e.shiftCode ?? null,
          deskCode: e.deskCode ?? null,
        });
      }
    }
    dates = workingDatesForMonth(year, monthParam);
    sheetName = `${year}-${String(monthParam).padStart(2, "0")}`;
    rowData = buildRows(dates, employees, entriesByEmpDate);
  } else {
    // ── Full year: one single sheet with all working days Jan–Dec ─────────────
    dates = [];
    for (let m = 1; m <= 12; m++) dates.push(...workingDatesForMonth(year, m));

    const entriesByEmpDate = new Map<string, { shiftCode: string | null; deskCode: string | null }>();

    const planningMonths = await db
      .select()
      .from(planningMonthsTable)
      .where(eq(planningMonthsTable.year, year));

    for (const pm of planningMonths) {
      const entries = await db
        .select()
        .from(planningEntriesTable)
        .where(eq(planningEntriesTable.planningMonthId, pm.id));
      for (const e of entries) {
        entriesByEmpDate.set(`${e.employeeId}::${e.date}`, {
          shiftCode: e.shiftCode ?? null,
          deskCode: e.deskCode ?? null,
        });
      }
    }

    sheetName = `Planning ${year}`;
    rowData = buildRows(dates, employees, entriesByEmpDate);
  }

  const result = await writeXlsxFile(rowData, {
    sheet: sheetName,
    columns: buildColumns(dates.length),
  });
  const buffer = await result.toBuffer();

  const filename = monthParam
    ? `planning-${year}-${String(monthParam).padStart(2, "0")}.xlsx`
    : `planning-${year}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

// ── IMPORT ───────────────────────────────────────────────────────────────────

router.post("/planning/excel-import", requireAdmin, upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  if (!req.file.originalname.toLowerCase().endsWith(".xlsx")) {
    res.status(400).json({ error: "Only .xlsx files are supported. Please export the file as .xlsx from your spreadsheet application." });
    return;
  }

  // Load all employees and shift codes for validation
  const employees = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable);
  const empByName = new Map(employees.map((e) => [e.name, e]));

  const shiftCodeRows = await db.select().from(shiftCodesTable);
  const validShiftCodes = new Set(shiftCodeRows.map((s) => s.code));

  // readXlsxFile (default export) reads ALL sheets at once.
  // Returns Sheet<number>[] where each Sheet = { sheet: string; data: SheetData }.
  // SheetData cell values are: string | number | boolean | Date | null
  let allSheets: Sheet<number>[];
  try {
    allSheets = await readXlsxFile(req.file.buffer);
  } catch {
    res.status(400).json({ error: "Could not parse Excel file. Ensure the file is a valid .xlsx document." });
    return;
  }

  type ImportEntry = {
    employeeId: number;
    date: string;
    shiftCode: string | null;
    deskCode: string | null;
  };

  const toImport: ImportEntry[] = [];
  const warnings: string[] = [];

  for (const sheetEntry of allSheets) {
    const sheetName = sheetEntry.sheet;

    // Convert all cell values to strings or null for consistent processing.
    const rows: (string | null)[][] = sheetEntry.data.map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return null;
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        const s = String(cell).trim();
        return s || null;
      })
    );

    if (rows.length < 2) continue;

    const headerRow = rows[0];
    // Dates start at column index 1
    const dateByCol = new Map<number, string>();
    for (let col = 1; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (cell && /^\d{4}-\d{2}-\d{2}$/.test(cell)) {
        dateByCol.set(col, cell);
      }
    }

    if (dateByCol.size === 0) {
      warnings.push(`Sheet "${sheetName}": no date columns found — skipped`);
      continue;
    }

    // Process rows in pairs: shift row then desk row.
    // A row is a "shift row" if col 0 does NOT end with DESK_SUFFIX.
    let i = 1;
    while (i < rows.length) {
      const row = rows[i];
      const label = row?.[0]?.trim() ?? "";
      if (!label || label.endsWith(DESK_SUFFIX)) {
        i++;
        continue;
      }

      const empName = label;
      const nextRow = rows[i + 1];
      const nextLabel = nextRow?.[0]?.trim() ?? "";
      const hasDeskRow = nextLabel === empName + DESK_SUFFIX;

      const emp = empByName.get(empName);
      if (!emp) {
        warnings.push(`Employee "${empName}" not found — skipped`);
        i += hasDeskRow ? 2 : 1;
        continue;
      }

      for (const [col, date] of dateByCol) {
        const shiftRaw = row?.[col]?.toString().trim() || null;
        const deskRaw = hasDeskRow ? (nextRow?.[col]?.toString().trim() || null) : null;

        const shiftCode = shiftRaw && validShiftCodes.has(shiftRaw) ? shiftRaw : null;
        if (shiftRaw && !validShiftCodes.has(shiftRaw)) {
          warnings.push(`"${empName}" ${date}: unknown shift code "${shiftRaw}" — ignored`);
        }

        if (shiftCode !== null || deskRaw !== null) {
          toImport.push({ employeeId: emp.id, date, shiftCode, deskCode: deskRaw });
        }
      }

      i += hasDeskRow ? 2 : 1;
    }
  }

  if (toImport.length === 0) {
    res.json({ ok: true, imported: 0, warnings });
    return;
  }

  // Group by year+month to find/create planning_months records
  type MonthKey = `${number}-${number}`;
  const pmCache = new Map<MonthKey, number>(); // key → planning_month_id

  async function getPmId(year: number, month: number): Promise<number> {
    const key: MonthKey = `${year}-${month}`;
    if (pmCache.has(key)) return pmCache.get(key)!;
    const [existing] = await db
      .select()
      .from(planningMonthsTable)
      .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));
    if (existing) {
      pmCache.set(key, existing.id);
      return existing.id;
    }
    const [created] = await db
      .insert(planningMonthsTable)
      .values({ year, month, status: "draft" })
      .returning({ id: planningMonthsTable.id });
    pmCache.set(key, created.id);
    return created.id;
  }

  let imported = 0;

  for (const item of toImport) {
    const [yearStr, monthStr] = item.date.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const pmId = await getPmId(year, month);

    // Check if there's an existing entry for this employee/date
    const [existing] = await db
      .select()
      .from(planningEntriesTable)
      .where(
        and(
          eq(planningEntriesTable.planningMonthId, pmId),
          eq(planningEntriesTable.employeeId, item.employeeId),
          eq(planningEntriesTable.date, item.date)
        )
      );

    if (existing) {
      await db
        .update(planningEntriesTable)
        .set({
          shiftCode: item.shiftCode,
          deskCode: item.deskCode,
          isLocked: true,
        })
        .where(eq(planningEntriesTable.id, existing.id));
    } else {
      await db.insert(planningEntriesTable).values({
        planningMonthId: pmId,
        employeeId: item.employeeId,
        date: item.date,
        shiftCode: item.shiftCode,
        deskCode: item.deskCode,
        isLocked: true,
        isPermanence: false,
        requestedOff: false,
      });
    }
    imported++;
  }

  res.json({ ok: true, imported, warnings });
});

export default router;
