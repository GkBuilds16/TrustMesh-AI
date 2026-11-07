import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

const statusOptions = ["OPEN", "IN_PROGRESS", "RESOLVED"];

export default function InvestigationCases({ api, ownerName, refreshKey = 0 }) {
  const [cases, setCases] = useState([]);
  const [notes, setNotes] = useState({});
  const [auditCaseId, setAuditCaseId] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [message, setMessage] = useState("");

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getInvestigationCases();
      setCases(result.cases || []);
    } catch (err) {
      setError(err.message || "Could not load your investigation cases.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) loadCases();
    });
    return () => { active = false; };
  }, [loadCases, refreshKey]);

  async function updateCase(record, status) {
    setError("");
    setMessage("");
    try {
      await api.updateInvestigationCase(
        record._id,
        status,
        notes[record._id] ?? record.resolutionNotes ?? ""
      );
      await loadCases();
      setMessage(`Case updated to ${status.replace("_", " ")}.`);
    } catch (err) {
      setError(err.message || "Could not update your investigation case.");
    }
  }

  async function toggleAudit(caseId) {
    if (auditCaseId === caseId) {
      setAuditCaseId(null);
      setAuditEvents([]);
      setAuditError("");
      return;
    }

    setAuditCaseId(caseId);
    setAuditEvents([]);
    setAuditError("");
    setAuditLoading(true);
    try {
      const result = await api.getInvestigationCaseAudit(caseId);
      setAuditEvents(result.events || []);
    } catch (err) {
      setAuditError(err.message || "Could not load your case audit history.");
    } finally {
      setAuditLoading(false);
    }
  }

  return (
    <section className="panel seller-panel personal-cases-panel" id="my-cases">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">PRIVATE WORKSPACE</div>
          <h2>My investigation cases</h2>
          <p className="muted">
            Owned by {ownerName}. Only you can view or update these cases and their audit history.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={loadCases}
          disabled={loading}
          aria-label="Refresh my investigation cases"
        >
          <RefreshCw size={18} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && <div className="error-banner" role="alert"><AlertTriangle size={18} />{error}</div>}
      {message && <p className="form-success" role="status">{message}</p>}
      {loading && cases.length === 0 && <p className="muted" role="status">Loading your cases...</p>}
      {!loading && !error && cases.length === 0 && (
        <div className="empty-state">
          <strong>No investigation cases yet</strong>
          <p>Save a recommended action from a seller investigation to track your work here.</p>
        </div>
      )}

      {cases.map((record) => (
        <article className="saved-case-card" key={record._id}>
          <div className="saved-case-heading">
            <div>
              <strong>{record.actionTitle}</strong>
              <p className="muted">Seller: {record.sellerId}</p>
              <span className="case-owner-label">Owned by you · private to your account</span>
            </div>
            <span className={`action-priority priority-${record.priority.toLowerCase()}`}>
              {record.priority}
            </span>
          </div>

          <p>Status: <strong>{record.status.replace("_", " ")}</strong></p>
          <label className="case-notes-label" htmlFor={`my-case-notes-${record._id}`}>
            Investigation notes
          </label>
          <textarea
            id={`my-case-notes-${record._id}`}
            value={notes[record._id] ?? record.resolutionNotes ?? ""}
            onChange={(event) => setNotes((previous) => ({ ...previous, [record._id]: event.target.value }))}
            maxLength={2000}
            rows={3}
            placeholder="Record investigation findings..."
            disabled={record.status === "RESOLVED" || loading}
          />

          {record.status !== "RESOLVED" && (
            <div className="case-status-controls">
              {statusOptions.filter((status) => status !== "RESOLVED").map((status) => (
                <button
                  type="button"
                  className="secondary-button"
                  key={status}
                  disabled={loading || record.status === status}
                  onClick={() => updateCase(record, status)}
                >
                  {status === record.status ? `Current: ${status.replace("_", " ")}` : `Set ${status.replace("_", " ")}`}
                </button>
              ))}
              <button
                type="button"
                className="secondary-button"
                disabled={loading}
                onClick={() => updateCase(record, record.status)}
              >Save notes</button>
              <button
                type="button"
                className="primary-button case-resolve-button"
                disabled={loading}
                onClick={() => updateCase(record, "RESOLVED")}
              >Resolve case</button>
            </div>
          )}

          {record.status === "RESOLVED" && (
            <p className="muted">Resolved {record.resolvedAt ? new Date(record.resolvedAt).toLocaleString() : ""}</p>
          )}

          <div className="case-audit-section">
            <button type="button" className="secondary-button" disabled={auditLoading} onClick={() => toggleAudit(record._id)}>
              {auditCaseId === record._id ? "Hide audit history" : "View private audit history"}
            </button>
            {auditCaseId === record._id && (
              <div className="case-audit-timeline">
                {auditLoading && <p className="muted" role="status">Loading audit history...</p>}
                {auditError && <p className="form-error" role="alert">{auditError}</p>}
                {!auditLoading && !auditError && auditEvents.length === 0 && <p className="muted">No audit events found for this case.</p>}
                {!auditLoading && !auditError && auditEvents.map((event) => (
                  <div className="case-audit-event" key={event._id}>
                    <div className="case-audit-marker" />
                    <div className="case-audit-event-content">
                      <strong>{event.eventType.replaceAll("_", " ")}</strong>
                      {(event.previousStatus || event.newStatus) && (
                        <p className="muted">
                          {event.previousStatus?.replaceAll("_", " ") || "New"} → {event.newStatus?.replaceAll("_", " ") || "—"}
                        </p>
                      )}
                      <p className="muted">{event.createdAt ? new Date(event.createdAt).toLocaleString() : "Timestamp unavailable"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
