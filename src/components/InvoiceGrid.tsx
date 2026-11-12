"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import type { Invoice } from "@/lib/paypal";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 13,
  accentColor: "#12325c",
  foregroundColor: "#1d1c1a",
  backgroundColor: "#fffdf9",
  headerBackgroundColor: "#fffdf9",
  headerTextColor: "#6f6b63",
  headerFontWeight: 500,
  borderColor: "#e3dfd6",
  rowBorder: { color: "#eeebe4" },
  columnBorder: false,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHoverColor: "#f6f4ef",
  selectedRowBackgroundColor: "#f0ede6",
  cellHorizontalPadding: 14,
  headerColumnResizeHandleColor: "transparent",
});

const NUM_RIGHT = "num flex items-center justify-end";
const NUM_LEFT = "num flex items-center";

const STATUS: Record<string, { dot: string; label: string }> = {
  PAID: { dot: "bg-good", label: "Paid" },
  MARKED_AS_PAID: { dot: "bg-good", label: "Paid" },
  SENT: { dot: "bg-brand", label: "Sent" },
  UNPAID: { dot: "bg-brand", label: "Unpaid" },
  PARTIALLY_PAID: { dot: "bg-warn", label: "Part paid" },
  DRAFT: { dot: "border border-muted bg-transparent", label: "Draft" },
  CANCELLED: { dot: "bg-line", label: "Cancelled" },
};

function fmtMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export type RowAction = "send" | "record-payment" | "remind-ai";

export default function InvoiceGrid({
  invoices,
  onAction,
}: {
  invoices: Invoice[];
  onAction: (action: RowAction, inv: Invoice) => void;
}) {
  const cols = useMemo<ColDef<Invoice>[]>(
    () => [
      { field: "number", headerName: "No.", width: 84, cellClass: `${NUM_LEFT} text-muted` },
      {
        field: "clientName",
        headerName: "Client",
        flex: 1,
        minWidth: 170,
        tooltipField: "items",
        cellRenderer: (p: ICellRendererParams<Invoice>) => (
          <span className="flex h-full flex-col justify-center leading-tight">
            <span className={`truncate ${p.node.rowPinned ? "" : "font-medium"}`}>{p.value}</span>
            {p.data?.items && <span className="truncate text-xs text-muted">{p.data.items}</span>}
          </span>
        ),
      },
      {
        field: "status",
        width: 150,
        cellRenderer: (p: ICellRendererParams<Invoice>) => {
          if (p.node.rowPinned) return null;
          const s = STATUS[p.value] ?? { dot: "bg-muted", label: String(p.value).toLowerCase() };
          const late = p.data?.daysOverdue ?? 0;
          return (
            <span className="flex h-full items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
              <span className={p.value === "CANCELLED" ? "text-muted line-through" : ""}>{s.label}</span>
              {late > 0 && <span className="num text-xs font-medium text-bad">{late}d late</span>}
            </span>
          );
        },
      },
      {
        field: "total",
        width: 110,
        type: "rightAligned",
        cellClass: NUM_RIGHT,
        valueFormatter: (p) => (p.data ? fmtMoney(p.value, p.data.currency) : ""),
      },
      {
        field: "due",
        headerName: "Owed",
        width: 110,
        type: "rightAligned",
        cellClass: NUM_RIGHT,
        valueFormatter: (p) => (p.data ? fmtMoney(p.value, p.data.currency) : ""),
      },
      {
        field: "dueDate",
        headerName: "Due",
        width: 88,
        filter: false,
        sort: "asc",
        cellClass: NUM_LEFT,
        valueFormatter: (p) =>
          p.value ? new Date(p.value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "",
      },
      {
        headerName: "",
        width: 250,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<Invoice>) => {
          if (p.node.rowPinned) return null;
          const inv = p.data!;
          const open = ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status);
          const link = "rounded px-1.5 py-0.5 text-[13px] text-brand hover:bg-paper hover:underline underline-offset-2";
          return (
            <span className="flex h-full items-center gap-1">
              {inv.status === "DRAFT" && (
                <button className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90" onClick={() => onAction("send", inv)}>
                  Send
                </button>
              )}
              {open && (
                <>
                  <button className={link} onClick={() => onAction("remind-ai", inv)}>
                    Remind
                  </button>
                  <button className={link} onClick={() => onAction("record-payment", inv)}>
                    Mark paid
                  </button>
                  <a
                    className={link}
                    href={`/c/${inv.id}`}
                    target="_blank"
                    rel="noreferrer"
                    title="The page your client sees: pay on PayPal, or ask for a plan or more time"
                  >
                    Client page ↗
                  </a>
                </>
              )}
            </span>
          );
        },
      },
    ],
    [onAction],
  );

  // Pinned footer: totals per currency (USD shown first).
  const totals = useMemo(() => {
    const byCur = new Map<string, Invoice>();
    for (const i of invoices) {
      // Match the "Outstanding" figure: drafts and cancelled invoices aren't owed yet.
      if (i.status === "CANCELLED" || i.status === "DRAFT") continue;
      const t =
        byCur.get(i.currency) ??
        ({ id: `total-${i.currency}`, number: "", clientName: `Total sent (${i.currency})`, currency: i.currency, total: 0, due: 0 } as Invoice);
      t.total += i.total;
      t.due += i.due;
      byCur.set(i.currency, t);
    }
    return [...byCur.values()];
  }, [invoices]);

  return (
    <div className="h-full w-full">
      <AgGridReact<Invoice>
        theme={theme}
        rowData={invoices}
        columnDefs={cols}
        defaultColDef={{ sortable: true, resizable: true }}
        getRowId={(p) => p.data.id}
        pinnedBottomRowData={totals}
        getRowStyle={(p) => (p.node.rowPinned ? { fontWeight: 600, background: "#f6f4ef" } : undefined)}
        rowHeight={52}
        headerHeight={40}
        overlayNoRowsTemplate="No invoices yet. Describe a job in the panel on the right to create one."
      />
    </div>
  );
}
