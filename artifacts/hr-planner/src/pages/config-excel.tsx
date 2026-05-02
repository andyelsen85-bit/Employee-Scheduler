import { useState, useRef } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Info,
} from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const MONTHS = [
  { value: 0, label: "Full year (single sheet)" },
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

type ImportState = "idle" | "loading" | "success" | "error";

interface ImportResult {
  imported: number;
  warnings: string[];
}

export default function ExcelExportImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exportYear, setExportYear] = useState(CURRENT_YEAR);
  const [exportMonth, setExportMonth] = useState(new Date().getMonth() + 1);

  const [importState, setImportState] = useState<ImportState>("idle");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function handleExport() {
    const params = new URLSearchParams({ year: String(exportYear) });
    if (exportMonth !== 0) params.set("month", String(exportMonth));
    const a = document.createElement("a");
    a.href = `/api/planning/excel-export?${params}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setImportResult(null);
    setImportState("idle");
  }

  async function handleImport() {
    if (!selectedFile) return;
    setImportState("loading");
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const resp = await fetch("/api/planning/excel-import", {
        method: "POST",
        body: formData,
      });
      const data = (await resp.json()) as { ok?: boolean; imported?: number; warnings?: string[]; error?: string };
      if (!resp.ok || data.error) {
        setImportState("error");
        toast({ title: "Import failed", description: data.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      setImportState("success");
      setImportResult({ imported: data.imported ?? 0, warnings: data.warnings ?? [] });
      toast({
        title: "Import complete",
        description: `${data.imported} entries imported as locked codes.`,
      });
    } catch {
      setImportState("error");
      toast({ title: "Import failed", description: "Could not reach the server.", variant: "destructive" });
    }
  }

  return (
    <Layout>
      <div className="p-6 max-w-3xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Excel Export / Import</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Export the planning grid to Excel, edit it, and import it back as locked entries.
            </p>
          </div>
        </div>

        {/* ── FORMAT NOTE ─────────────────────────────────────── */}
        <div className="rounded-lg border bg-muted/40 p-4 flex gap-3">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <strong>File format:</strong> Each employee occupies two rows — the first row carries the{" "}
              <em>shift code</em>, the second (labelled <em>Name Desk</em>) carries the{" "}
              <em>desk code</em>. Columns are week-day dates (weekends omitted).
            </p>
            <p>
              <strong>On import:</strong> every non-empty cell is saved as a <em>locked</em> planning
              entry. If a shift code is set but no desk code, the auto-planner will assign a desk
              automatically the next time you generate the month.
            </p>
          </div>
        </div>

        {/* ── EXPORT ──────────────────────────────────────────── */}
        <section className="rounded-lg border p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Export</h2>
          </div>

          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <label className="text-sm font-medium">Year</label>
              <select
                className="block h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                value={exportYear}
                onChange={(e) => setExportYear(parseInt(e.target.value, 10))}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Period</label>
              <select
                className="block h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                value={exportMonth}
                onChange={(e) => setExportMonth(parseInt(e.target.value, 10))}
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <Button onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" />
              Download Excel
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Both full-year and single-month exports produce a single sheet with all working weekdays as columns.
            Weekends are omitted. Columns show dates in <code>YYYY-MM-DD</code> format — keep them
            unchanged when editing for a clean re-import.
          </p>
        </section>

        {/* ── IMPORT ──────────────────────────────────────────── */}
        <section className="rounded-lg border p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Import</h2>
          </div>

          <p className="text-sm text-muted-foreground">
            Select a previously exported (and edited) Excel file. Only cells with a value are
            imported. Existing non-locked entries for those dates will be updated; locked entries
            will be overwritten with the imported values.
          </p>

          <div className="flex flex-wrap gap-3 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {selectedFile ? selectedFile.name : "Select Excel file…"}
            </Button>

            {selectedFile && (
              <Button
                onClick={handleImport}
                disabled={importState === "loading"}
                className="gap-2"
              >
                {importState === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {importState === "loading" ? "Importing…" : "Import"}
              </Button>
            )}
          </div>

          {importState === "success" && importResult && (
            <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {importResult.imported} entr{importResult.imported === 1 ? "y" : "ies"} imported as locked codes
              </div>
              {importResult.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Warnings
                  </p>
                  <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc list-inside space-y-0.5">
                    {importResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {importState === "error" && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Import failed — see the toast notification for details.
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
