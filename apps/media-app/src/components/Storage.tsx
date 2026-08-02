import { useEffect, useState } from "react";
import { api, StorageStats } from "../api";

const GB = 1024 ** 3;
const formatGb = (bytes: number) => `${(bytes / GB).toFixed(2)} GB`;

const ITEM_COUNT_LABELS: Record<string, string> = {
  media: "Media items",
  folders: "Folders",
  shares: "Shares",
  activity: "Activity log entries",
};

export function Storage() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .stats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!stats) return null;

  const { storage, security, itemCounts, lambdaErrors, ses } = stats;
  const tiers = [
    { label: "Standard", bytes: storage.byTier.standardBytes },
    { label: "Intelligent-Tiering (Frequent)", bytes: storage.byTier.intelligentTieringFrequentBytes },
    { label: "Intelligent-Tiering (Infrequent)", bytes: storage.byTier.intelligentTieringInfrequentBytes },
    { label: "Intelligent-Tiering (Archive Instant)", bytes: storage.byTier.intelligentTieringArchiveInstantBytes },
  ];

  return (
    <div>
      <div className="stat-cards">
        <div className="stat-card">
          <h3>Total storage</h3>
          <p className="value">{formatGb(storage.totalBytes)}</p>
        </div>
        <div className="stat-card">
          <h3>Objects</h3>
          <p className="value">{storage.objectCount.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <h3>Estimated cost</h3>
          <p className="value">${storage.estimatedMonthlyCostUsd.toFixed(2)}/mo</p>
        </div>
      </div>

      <h3>Storage by tier</h3>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Size</th>
              <th>% of total</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.label}>
                <td>{t.label}</td>
                <td>{formatGb(t.bytes)}</td>
                <td>{storage.totalBytes ? `${((t.bytes / storage.totalBytes) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Storage-by-tier updates once a day (S3's own metric refresh rate) — a change won't show up immediately.
      </p>

      <h3>Data growth</h3>
      <div className="matrix-wrap">
        <table className="matrix">
          <tbody>
            {Object.entries(itemCounts).map(([key, count]) => (
              <tr key={key}>
                <td>{ITEM_COUNT_LABELS[key] ?? key}</td>
                <td>{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Lambda health (errors, last 7 days)</h3>
      <div className="matrix-wrap">
        <table className="matrix">
          <tbody>
            {lambdaErrors.map((fn) => (
              <tr key={fn.label}>
                <td>{fn.label}</td>
                <td>
                  {fn.errorsLast7Days}
                  {fn.errorsLast7Days > 0 && <span className="badge badge-warn">check logs</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Security (last 7 days)</h3>
      <div className="matrix-wrap">
        <table className="matrix">
          <tbody>
            <tr>
              <td>WAF blocked requests</td>
              <td>{security.wafBlockedRequests.toLocaleString()}</td>
            </tr>
            <tr>
              <td>API 4xx errors</td>
              <td>{security.api4xxErrors.toLocaleString()}</td>
            </tr>
            <tr>
              <td>API 5xx errors</td>
              <td>{security.api5xxErrors.toLocaleString()}</td>
            </tr>
            <tr>
              <td>API throttled requests</td>
              <td>
                {security.apiThrottleCount.toLocaleString()}
                {security.apiThrottleCount > 0 && <span className="badge badge-warn">check logs</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">
        A sharp rise in any of these also triggers an email alert (WAF blocks, API 4xx, or any throttling) — this
        table is for browsing, not the only line of defense.
      </p>

      <h3>Email sending (SES)</h3>
      {ses ? (
        <div className="matrix-wrap">
          <table className="matrix">
            <tbody>
              <tr>
                <td>Status</td>
                <td>
                  {ses.productionAccessEnabled ? "Production" : "Sandbox"}
                  <span className={`badge ${ses.productionAccessEnabled ? "" : "badge-warn"}`}>
                    {ses.productionAccessEnabled ? "OK" : "limited"}
                  </span>
                </td>
              </tr>
              <tr>
                <td>Sent, last 24h</td>
                <td>
                  {ses.sentLast24Hours.toLocaleString()} / {ses.max24HourSend.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">SES status unavailable.</p>
      )}
    </div>
  );
}
