"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import type { Invoice } from "@/lib/paypal";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: "#1a73e8",
  headerBackgroundColor: "#f1f5fb",
  fontSize: 13,
  borderRadius: 8,
});

const STATUS_STYLE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-800",
  MARKED_AS_PAID: "bg-emerald-100 text-emerald-800",
  SENT: "bg-blue-100 text-blue-800",
  UNPAID: "bg-blue-100 text-blue-800",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800",
  DRAFT: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-rose-100 text-rose-700",
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
      { field: "number", headerName: "Invoice", width: 92 },
      {
        field: "clientName",
        headerName: "Client",
        flex: 1,
        minWidth: 170,
        tooltipField: "items",
        cellRenderer: (p: ICellRendererParams<Invoice>) => (
          <span className="flex h-full flex-col justify-center leading-tight">
            <span className="truncate">{p.value}</span>
            {p.data?.items && <span className="truncate text-xs text-slate-500">{p.data.items}</span>}
          </span>
        ),
      },
      {
        field: "status",
        width: 142,
        cellRenderer: (p: ICellRendererParams<Invoice>) => {
          if (p.node.rowPinned) return null;
          const overdue = (p.data?.daysOverdue ?? 0) > 0;
          return (
            <span className="flex h-full items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.value] ?? "bg-slate-100"}`}>
                {String(p.value).replace(/_/g, " ").toLowerCase()}
              </span>
              {overdue && (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-medium text-white">
                  {p.data!.daysOverdue}d late
                </span>
              )}
            </span>
          );
        },
      },
      {
        field: "total",
        width: 104,
        type: "rightAligned",
        valueFormatter: (p) => (p.data ? fmtMoney(p.value, p.data.currency) : ""),
      },
      {
        field: "due",
        headerName: "Owed",
        width: 104,
        type: "rightAligned",
        valueFormatter: (p) => (p.data ? fmtMoney(p.value, p.data.currency) : ""),
      },
      {
        field: "dueDate",
        headerName: "Due",
        width: 92,
        filter: false,
        sort: "asc",
        valueFormatter: (p) =>
          p.value ? new Date(p.value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "",
      },
      {
        headerName: "Actions",
        width: 272,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (p: ICellRendererParams<Invoice>) => {
          if (p.node.rowPinned) return null;
          const inv = p.data!;
          const open = ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status);
          const btn = "rounded-md px-2 py-0.5 text-xs font-medium border";
          return (
            <span className="flex h-full items-center gap-1.5">
              {inv.status === "DRAFT" && (
                <button className={`${btn} border-blue-600 bg-blue-600 text-white`} onClick={() => onAction("send", inv)}>
                  Send
                </button>
              )}
              {open && (
                <>
                  <button className={`${btn} border-slate-300 bg-white`} onClick={() => onAction("remind-ai", inv)}>
                    ✨ Remind
                  </button>
                  <button className={`${btn} border-slate-300 bg-white`} onClick={() => onAction("record-payment", inv)}>
                    Mark paid
                  </button>
                </>
              )}
              {open && (
                <a
                  className={`${btn} border-slate-300 bg-white`}
                  href={`/c/${inv.id}`}
                  target="_blank"
                  rel="noreferrer"
                  title="The page your client sees: pay on PayPal, or ask for a plan or more time"
                >
                  Client page
                </a>
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
      // Match the "Outstanding" card: drafts and cancelled invoices aren't owed yet.
      if (i.status === "CANCELLED" || i.status === "DRAFT") continue;
      const t =
        byCur.get(i.currency) ??
        ({ id: `total-${i.currency}`, number: "Total", clientName: `${i.currency} · sent invoices`, currency: i.currency, total: 0, due: 0 } as Invoice);
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
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        getRowId={(p) => p.data.id}
        pinnedBottomRowData={totals}
        getRowStyle={(p) => (p.node.rowPinned ? { fontWeight: 600, background: "#f1f5fb" } : undefined)}
        rowHeight={50}
        overlayNoRowsTemplate="No invoices yet. Ask PayPilot to create one."
      />
    </div>
  );
}
