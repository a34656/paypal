"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { escapeCsvCell } from "@/lib/csv";
import { formatTime } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/states";

// Community modules only (CSV export is included in Community). No Enterprise features.
ModuleRegistry.registerModules([AllCommunityModule]);

const aegisTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#090D14",
  foregroundColor: "#F3F7FB",
  headerBackgroundColor: "#0D1420",
  headerTextColor: "#8B9AAF",
  borderColor: "#1A2433",
  rowHoverColor: "rgba(86,224,240,0.05)",
  selectedRowBackgroundColor: "rgba(102,133,255,0.14)",
  accentColor: "#56E0F0",
  fontFamily: "inherit",
  fontSize: 13,
});

export interface TxRow {
  id: string;
  kind: "PAYMENT" | "PROPOSAL";
  missionId: string;
  missionTitle: string;
  product: string | null;
  seller: string | null;
  category: string | null;
  amountMinor: number | null;
  currency: string;
  status: string;
  decision: string | null;
  riskScore: number | null;
  mode: string;
  provider: string | null;
  providerOrderId: string | null;
  providerCaptureId: string | null;
  simulated: boolean;
  createdAt: string;
  updatedAt: string;
}

export function TransactionsView() {
  const { data, error, isLoading, mutate } = useApi<{ rows: TxRow[] }>("/api/transactions");
  const grid = useRef<AgGridReact<TxRow>>(null);
  const [selected, setSelected] = useState<TxRow | null>(null);

  const columns = useMemo<ColDef<TxRow>[]>(
    () => [
      { field: "kind", headerName: "Type", width: 110, filter: true },
      {
        field: "missionTitle",
        headerName: "Mission",
        flex: 1.4,
        minWidth: 200,
        filter: true,
        cellRenderer: (p: ICellRendererParams<TxRow>) => (p.data ? <Link href={`/missions/${p.data.missionId}`} className="hover:text-cyan">{p.value}</Link> : null),
      },
      { field: "product", headerName: "Product", flex: 1.2, minWidth: 180, filter: true },
      { field: "seller", headerName: "Seller", flex: 1, minWidth: 160, filter: true },
      { field: "amountMinor", headerName: "Amount", width: 130, type: "rightAligned", filter: "agNumberColumnFilter", valueFormatter: (p) => formatMoney(p.value, p.data?.currency) },
      { field: "status", headerName: "Status", width: 190, filter: true, cellRenderer: (p: ICellRendererParams<TxRow>) => <StatusBadge status={p.value} /> },
      { field: "decision", headerName: "Policy", width: 170, filter: true, cellRenderer: (p: ICellRendererParams<TxRow>) => (p.value ? <StatusBadge status={p.value} /> : "—") },
      { field: "riskScore", headerName: "Risk", width: 90, filter: "agNumberColumnFilter" },
      { field: "mode", headerName: "Mode", width: 160, filter: true, cellRenderer: (p: ICellRendererParams<TxRow>) => <ModeBadge mode={p.value} simulated={p.data?.simulated} /> },
      { field: "providerOrderId", headerName: "Provider order", width: 170, filter: true },
      { field: "createdAt", headerName: "Created", width: 170, sort: "desc", valueFormatter: (p) => formatTime(p.value) },
    ],
    [],
  );

  const exportCsv = () =>
    grid.current?.api.exportDataAsCsv({
      fileName: `aegis-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
      // Formula-injection guard on every exported cell.
      processCellCallback: (p) => escapeCsvCell(p.column.getColId() === "amountMinor" ? formatMoney(p.value, p.node?.data?.currency) : p.value),
    });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Operations"
        title="Transactions"
        subtitle="Payments and policy proposals. DEMO rows are simulated (no money moved); SANDBOX rows are PayPal Sandbox test payments. Modes are never blended."
        actions={
          <Button onClick={exportCsv} disabled={!data?.rows.length}>
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </Button>
        }
      />
      <ErrorState error={error} retry={() => mutate()} />
      <Panel className="overflow-hidden">
        {isLoading ? (
          <Spinner className="p-6" />
        ) : (
          <div className="h-[520px] w-full">
            <AgGridReact<TxRow>
              ref={grid}
              theme={aegisTheme}
              rowData={data?.rows ?? []}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true }}
              pagination
              paginationPageSize={25}
              paginationPageSizeSelector={[25, 50, 100]}
              rowSelection={{ mode: "singleRow", enableClickSelection: true }}
              onSelectionChanged={(e) => setSelected(e.api.getSelectedRows()[0] ?? null)}
              getRowId={(p) => p.data.id}
              overlayNoRowsTemplate="<span style='color:#8B9AAF'>No transactions yet. Run a mission to create one.</span>"
            />
          </div>
        )}
      </Panel>
      {selected && (
        <Panel>
          <PanelHeader title="Transaction details" actions={<ModeBadge mode={selected.mode} simulated={selected.simulated} />} />
          <PanelBody>
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["ID", selected.id],
                  ["Type", selected.kind],
                  ["Mission", selected.missionTitle],
                  ["Amount", formatMoney(selected.amountMinor, selected.currency)],
                  ["Status", selected.status],
                  ["Policy decision", selected.decision ?? "—"],
                  ["Provider", selected.provider ?? "—"],
                  ["Provider order", selected.providerOrderId ?? "—"],
                  ["Capture", selected.providerCaptureId ?? "—"],
                  ["Category", selected.category ?? "—"],
                  ["Created", formatTime(selected.createdAt)],
                  ["Updated", formatTime(selected.updatedAt)],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-all font-mono">{v}</dd>
                </div>
              ))}
            </dl>
            {selected.simulated && <p className="mt-3 text-xs text-purple">Simulated record. No money moved and this is not a PayPal payment.</p>}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
