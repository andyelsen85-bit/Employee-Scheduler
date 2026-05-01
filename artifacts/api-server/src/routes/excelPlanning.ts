import { Router } from "express";
import * as XLSX from "xlsx";
import multer from "multer";
import { db } from "@workspace/db";
import {
  employeesTable,
  planningMonthsTable,
  planningEntriesTable,
  shiftCodesTable,
  officesTable,
  officeEmployeesTable,
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

/** Build one worksheet for a given month. */
async function buildSheet(
  year: number,
  month: number,
  employees: { id: number; name: string; displayOrder: number }[],
  entriesByEmpDate: Map<string, { shiftCode: string | null; deskCode: string | null }>
): Promise<XLSX.WorkSheet> {
  const dates = workingDatesForMonth(year, month);

  const headerRow = ["Employee", ...dates];
  const rows: (string | null)[][] = [headerRow];

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

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths: first col wider, date cols narrow
  ws["!cols"] = [{ wch: 20 }, ...dates.map(() => ({ wch: 10 }))];

  return ws;
}

// ── EXPORT ───────────────────────────────────────────────────────────────────

router.get("/planning/excel-export", async (req, res): Promise<void> => {
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

  const months = monthParam ? [monthParam] : Array.from({ length: 12 }, (_, i) => i + 1);

  // Fetch all relevant planning entries in one query per month
  const wb = XLSX.utils.book_new();

  for (const month of months) {
    const [pm] = await db
      .select()
      .from(planningMonthsTable)
      .where(and(eq(planningMonthsTable.year, year), eq(planningMonthsTable.month, month)));

    const entriesByEmpDate = new Map<string, { shiftCode: string | null; deskCode: string | null }>();

    if (pm) {
      const entries = await db
        .select()
        .from(planningEntriesTable)
        .where(eq(planningEntriesTable.planningMonthId, pm.id));

      for (const e of entries) {
        const key = `${e.employeeId}::${e.date}`;
        entriesByEmpDate.set(key, { shiftCode: e.shiftCode ?? null, deskCode: e.deskCode ?? null });
      }
    }

    const sheetName = monthParam
      ? `${year}-${String(month).padStart(2, "0")}`
      : new Date(year, month - 1, 1).toLocaleString("en", { month: "short" }) + ` ${year}`;

    const ws = await buildSheet(year, month, employees, entriesByEmpDate);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const filename = monthParam
    ? `planning-${year}-${String(monthParam).padStart(2, "0")}.xlsx`
    : `planning-${year}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
});

// ── IMPORT ───────────────────────────────────────────────────────────────────

router.post("/planning/excel-import", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  // Load all employees and shift codes for validation
  const employees = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable);
  const empByName = new Map(employees.map((e) => [e.name, e]));

  const shiftCodeRows = await db.select().from(shiftCodesTable);
  const validShiftCodes = new Set(shiftCodeRows.map((s) => s.code));

  // Parse workbook — supports single month or full-year (multi-sheet)
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
  } catch {
    res.status(400).json({ error: "Could not parse Excel file" });
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

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: (string | null | undefined)[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      raw: false,
    }) as (string | null | undefined)[][];

    if (rows.length < 2) continue;

    const headerRow = rows[0];
    // Dates start at column index 1
    const dateByCol: Map<number, string> = new Map();
    for (let col = 1; col < headerRow.length; col++) {
      const cell = headerRow[col];
      if (cell && typeof cell === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cell.trim())) {
        dateByCol.set(col, cell.trim());
      }
    }

    if (dateByCol.size === 0) {
      warnings.push(`Sheet "${sheetName}": no date columns found — skipped`);
      continue;
    }

    // Process rows in pairs: shift row then desk row
    // A row is a "shift row" if col 0 does NOT end with DESK_SUFFIX
    let i = 1;
    while (i < rows.length) {
      const row = rows[i];
      const label = (row?.[0] as string | null | undefined)?.trim() ?? "";
      if (!label || label.endsWith(DESK_SUFFIX)) {
        i++;
        continue;
      }

      const empName = label;
      const nextRow = rows[i + 1];
      const nextLabel = (nextRow?.[0] as string | null | undefined)?.trim() ?? "";
      const hasDeskRow = nextLabel === empName + DESK_SUFFIX;

      const emp = empByName.get(empName);
      if (!emp) {
        warnings.push(`Employee "${empName}" not found — skipped`);
        i += hasDeskRow ? 2 : 1;
        continue;
      }

      for (const [col, date] of dateByCol) {
        const shiftRaw = (row?.[col] as string | null | undefined)?.toString().trim() || null;
        const deskRaw = hasDeskRow
          ? ((nextRow?.[col] as string | null | undefined)?.toString().trim() || null)
          : null;

        const shiftCode = shiftRaw && validShiftCodes.has(shiftRaw) ? shiftRaw : shiftRaw ? null : null;
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
