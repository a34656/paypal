"use client";
import { AlertTriangle, Bot, Boxes, CheckCircle2, CircleOff, Database, Flag, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useApi } from "@/lib/client/api";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/states";
import { ChainIndicator } from "./audit-view";

interface Status {
  mode: string;
  environment: string;
  nodeEnv: string;
  database: { ok: boolean; detail: string };
  paypal: { connected: boolean; baseUrl: string; live: boolean; clientId: string | null; publicClientIdMatches: boolean | null; webhookConfigured: boolean; merchantIdConfigured: boolean };
  ai: { connected: boolean; model: string | null; fallback: string };
  productProvider: { active: string; channel3: string };
  flags: Record<string, boolean>;
  warnings: string[];
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
const On = ({ on, yes = "Connected", no = "Not connected" }: { on: boolean; yes?: string; no?: string }) =>
  on ? (
    <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" aria-hidden />}>
      {yes}
    </Badge>
  ) : (
    <Badge icon={<CircleOff className="h-3 w-3" aria-hidden />}>{no}</Badge>
  );

export function SettingsView() {
  const { data, error, mutate } = useApi<Status>("/api/system/status");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="System" title="Settings" subtitle="Integration status and environment. Secret values are never displayed." actions={<Badge tone={data.mode === "DEMO" ? "purple" : "blue"}>{data.mode === "DEMO" ? "Demo mode" : `${data.mode} mode`}</Badge>} />
      {data.warnings.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          {data.warnings.map((w) => (
            <p key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="PayPal" icon={<Wallet className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            <Row label="Status">
              <On on={data.paypal.connected} />
            </Row>
            <Row label="API host">
              <span className="font-mono text-xs">{data.paypal.baseUrl}</span> {data.paypal.live ? <Badge tone="critical">LIVE</Badge> : <Badge tone="blue">Sandbox</Badge>}
            </Row>
            <Row label="Client ID">{data.paypal.clientId ? <span className="font-mono text-xs">{data.paypal.clientId}</span> : "—"}</Row>
            <Row label="Browser client ID matches">{data.paypal.publicClientIdMatches == null ? "—" : data.paypal.publicClientIdMatches ? <On on yes="Matches" /> : <Badge tone="critical">Mismatch</Badge>}</Row>
            <Row label="Webhook">
              <On on={data.paypal.webhookConfigured} yes="Configured" no="Not configured" />
            </Row>
            <Row label="Payee merchant check">
              <On on={data.paypal.merchantIdConfigured} yes="Enabled" no="Skipped (PAYPAL_MERCHANT_ID unset)" />
            </Row>
            {!data.paypal.connected && (
              <div className="mt-3 rounded-md border border-line bg-bg p-3 text-xs text-muted">
                <p className="mb-1 font-medium text-fg">Configure PayPal Sandbox</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  <li>Create a Sandbox REST app at developer.paypal.com → Apps &amp; Credentials (Sandbox).</li>
                  <li>
                    Set <code className="font-mono">PAYPAL_CLIENT_ID</code>, <code className="font-mono">PAYPAL_CLIENT_SECRET</code> and <code className="font-mono">NEXT_PUBLIC_PAYPAL_CLIENT_ID</code> (same app) in <code className="font-mono">.env</code>.
                  </li>
                  <li>
                    Keep <code className="font-mono">PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com</code>. Restart the server.
                  </li>
                  <li>Log in to checkout with a Sandbox personal (buyer) account.</li>
                </ol>
              </div>
            )}
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Database & audit" icon={<Database className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            <Row label="PostgreSQL">
              <On on={data.database.ok} yes={data.database.detail} no={data.database.detail} />
            </Row>
            <Row label="Audit chain">
              <ChainIndicator />
            </Row>
            <Row label="Environment">
              <span className="font-mono text-xs">
                {data.environment} / {data.nodeEnv}
              </span>
            </Row>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="AI" icon={<Bot className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            <Row label="Anthropic">
              <On on={data.ai.connected} />
            </Row>
            <Row label="Model (AI_MODEL)">{data.ai.model ? <span className="font-mono text-xs">{data.ai.model}</span> : "—"}</Row>
            <Row label="Fallback">{data.ai.fallback}</Row>
            <p className="mt-2 text-xs text-muted">LLM output is a proposal or display-only text. It cannot change scores, decisions, policy, approvals or payments.</p>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Product provider" icon={<Boxes className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            <Row label="Active">
              <Badge tone="purple">Demo catalogue (fictional sellers)</Badge>
            </Row>
            <Row label="Channel3">{data.productProvider.channel3}</Row>
          </PanelBody>
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader title="Feature flags & demo controls" icon={<Flag className="h-4 w-4 text-cyan" />} />
          <PanelBody className="grid gap-x-8 sm:grid-cols-2">
            <Row label="Webhook processing">
              <On on={data.flags.webhooks} yes="On" no="Off" />
            </Row>
            <Row label="LLM explanations">
              <On on={data.flags.llmExplanations} yes="On" no="Off (deterministic)" />
            </Row>
            <Row label="Live payments">
              <Badge tone="success">Refused by default</Badge>
            </Row>
            <Row label="Approver role">Toggle from the identity menu (top right)</Row>
            <Row label="Reset demo data">
              <code className="font-mono text-xs">npm run demo:reset</code>
            </Row>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
