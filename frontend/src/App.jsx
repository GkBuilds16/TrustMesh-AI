
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Fingerprint,
  Gauge,
  Network,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "./services/api";
import SellerGraph from "./components/SellerGraph";
import InvestigationCases from "./components/InvestigationCases";
import PaymentsWorkspace from "./components/PaymentsWorkspace";
import "./App.css";
import Auth from "./Auth";
import { clearSession, readStoredSession, saveSession } from "./services/session";
const initialEvidence = {
  sharedBeneficiary: false,
  highTransactionVelocity: false,
  unusualTransactionAmount: false,
  incompleteSellerVerification: false,
};

function MetricCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon size={19} />
      </div>
      <p className="muted metric-label">{label}</p>
      <div className="metric-value">{value}</div>
      <p className="muted metric-detail">{detail}</p>
    </article>
  );
}

function App() {
  const [health, setHealth] = useState("checking");
  const [sellers, setSellers] = useState([]);
  const [loading, setLoading] = useState(false);

const [historySellerFilter, setHistorySellerFilter] = useState("");

  const [assessmentHistory, setAssessmentHistory] = useState([]);
const [historyPagination, setHistoryPagination] = useState({
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
});
const [historyLoading, setHistoryLoading] = useState(false);
const [historyError, setHistoryError] = useState("");
const [selectedHistoryAssessment, setSelectedHistoryAssessment] = useState(null);

  const [error, setError] = useState("");
  const [riskSellerId, setRiskSellerId] = useState("");
  const [investigationSellerId, setInvestigationSellerId] = useState("");
  const [investigation, setInvestigation] = useState(null);
  const [caseRefreshKey, setCaseRefreshKey] = useState(0);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [investigationLoading, setInvestigationLoading] = useState(false);

  const [evidence, setEvidence] = useState(initialEvidence);
  const [assessment, setAssessment] = useState(null);
  const [sellerForm, setSellerForm] = useState({
  sellerId: "",
  displayName: "",
  beneficiaryIds: "",
  verificationStatus: "UNVERIFIED",
});

const [sellerMessage, setSellerMessage] = useState("");
const [sellerError, setSellerError] = useState("");
const [registeringSeller, setRegisteringSeller] = useState(false);
const [sessionUser, setSessionUser] = useState(() => readStoredSession());
const [workspaceNotice, setWorkspaceNotice] = useState("");
const [savingCase, setSavingCase] = useState(false);

const handleLogin = useCallback((result) => {
  setSessionUser(saveSession(result));
}, []);

const handleLogout = useCallback(() => {
  clearSession();
  setSessionUser(null);
  setHealth("checking");
  setSellers([]);
  setAssessmentHistory([]);
  setInvestigation(null);
  setAssessment(null);
  setSelectedHistoryAssessment(null);
  setRiskSellerId("");
  setInvestigationSellerId("");
  setError("");
  setHistoryError("");
  setSellerError("");
  setSellerMessage("");
  setWorkspaceNotice("");
}, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const results = await Promise.allSettled([
        api.getHealth(),
        api.getSellers(),
      ]);

      if (results[0].status === "fulfilled") {
        setHealth(
          results[0].value.success ? "connected" : "error"
        );
      } else {
        setHealth("offline");
      }

      if (results[1].status === "fulfilled") {
        setSellers(results[1].value.sellers || []);
      } else {
        setSellers([]);
        setError(
          "Could not load sellers. Check that the backend and database are running."
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);


const loadAssessmentHistory = useCallback(async (
  page = 1,
  sellerFilter = historySellerFilter
) => {
  setHistoryLoading(true);
  setHistoryError("");

  try {
    const result = await api.getAssessmentHistory(
      page,
      10,
      sellerFilter
    );

    setAssessmentHistory(result.assessments || []);
    setHistoryPagination(
      result.pagination || {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      }
    );
  } catch (err) {
    setHistoryError(
      err.message || "Failed to load assessment history."
    );
  } finally {
    setHistoryLoading(false);
  }
}, [historySellerFilter]);



useEffect(() => {
  function handleUnauthorized() {
    handleLogout();
  }
  window.addEventListener("trustmesh:unauthorized", handleUnauthorized);
  return () => window.removeEventListener("trustmesh:unauthorized", handleUnauthorized);
}, [handleLogout]);

useEffect(() => {
  if (sessionUser) {
    Promise.resolve().then(() => {
      if (sessionStorage.getItem("trustmesh_token")) {
        loadDashboard();
        loadAssessmentHistory(1, historySellerFilter);
      }
    });
  }
}, [sessionUser, loadDashboard, loadAssessmentHistory, historySellerFilter]);


  async function runAssessment(event) {
    event.preventDefault();
    setError("");
    setAssessment(null);
    setAssessmentLoading(true);

    try {

const result = await api.evaluateRisk(
  evidence,
  riskSellerId.trim() || undefined
);

      setAssessment(result.assessment);
      await loadAssessmentHistory(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setAssessmentLoading(false);
    }
  }

  async function searchSeller(event) {
    event.preventDefault();
    if (!investigationSellerId.trim()) return;

    setError("");
    setInvestigation(null);
    setInvestigationLoading(true);

    try {
      const result = await api.investigateSeller(investigationSellerId.trim());
      setInvestigation(result.investigation);
    } catch (err) {
      setError(err.message);
    } finally {
      setInvestigationLoading(false);
    }
  }

async function handleCreateInvestigationCase(action) {
  const currentSellerId = investigation?.seller?.sellerId;
  if (!currentSellerId || !action) return;

  setSavingCase(true);
  setError("");
  try {
    await api.createInvestigationCase(currentSellerId, action);
    setCaseRefreshKey((current) => current + 1);
    setWorkspaceNotice(`Case saved: ${action.title}`);
  } catch (err) {
    setError(err.message || "Could not create investigation case.");
  } finally {
    setSavingCase(false);
  }
}


  async function handleRegisterSeller(event) {
  event.preventDefault();
  setSellerMessage("");
  setSellerError("");
  setRegisteringSeller(true);

  try {
    const payload = {
      sellerId: sellerForm.sellerId.trim(),
      displayName: sellerForm.displayName.trim(),
      beneficiaryIds: sellerForm.beneficiaryIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      verificationStatus: sellerForm.verificationStatus,
    };

    await api.registerSeller(payload);

    setSellerMessage("Seller registered successfully.");
    setSellerForm({
      sellerId: "",
      displayName: "",
      beneficiaryIds: "",
      verificationStatus: "UNVERIFIED",
    });

    await loadDashboard();
  } catch (err) {
    setSellerError(err.message || "Could not register seller.");
  } finally {
    setRegisteringSeller(false);
  }
}

  const connected = health === "connected";
  const flaggedCount = sellers.filter(
    (seller) => seller.riskStatus === "FLAGGED"
  ).length;

  const decisionIcon = {
    ALLOW: ShieldCheck,
    REVIEW: AlertTriangle,
    BLOCK: ShieldAlert,
  };
  const ResultIcon = assessment
    ? decisionIcon[assessment.decision] || Gauge
    : Gauge;
if (!sessionUser) {
  return <Auth onLogin={handleLogin} />;
}
  return (
    <div className="app-shell">
      <a className="skip-link" href="#overview">Skip to main content</a>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <div className="brand-mark"><Fingerprint size={25} /></div>
          <div>
            <strong>TrustMesh<span> AI</span></strong>
            <small>TRUST & RISK INTELLIGENCE</small>
          </div>
        </a>

        <nav aria-label="Workspace">
          <div className="nav-caption">WORKSPACE</div>
          <a className="nav-link active" href="#overview">
            <Gauge size={18} /> Overview
          </a>
          <a className="nav-link" href="#investigation">
            <Network size={18} /> Investigations
          </a>
          <a className="nav-link" href="#assessment">
            <Shield size={18} /> Risk assessment
          </a>
          <a className="nav-link" href="#history">
            <Activity size={18} /> Assessment history
          </a>
          <a className="nav-link" href="#sellers">
            <Users size={18} /> Sellers
          </a>
          <a className="nav-link" href="#my-cases">
            <ClipboardList size={18} /> My cases
          </a>
          <a className="nav-link" href="#payments">
            <CreditCard size={18} /> Payments
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="agent-card">
            <div className="agent-icon"><Bot size={20} /></div>
            <strong>Investigation agent</strong>
            <p>Evidence-first risk intelligence.</p>
            <span className="coming-soon">AI ASSISTANT · PLANNED</span>
          </div>
          <div className="connection">
            <span className={`status-dot ${connected ? "online" : ""}`} />
            <div>
              <strong>Backend API</strong>
              <small>{connected ? "Connected" : health === "checking" ? "Connecting…" : "Unavailable"}</small>
            </div>
            <button className="icon-button" onClick={loadDashboard} aria-label="Refresh backend">
              <RefreshCw size={16} />
            </button>
          </div>
          <button className="secondary-button" onClick={handleLogout}>
  Sign out ({sessionUser.name})
</button>
        </div>
      </aside>

      <main className="main-content" id="overview" tabIndex={-1}>
        <header className="topbar">
          <div>
            <div className="breadcrumb">Workspace <ChevronRight size={13} /> Overview</div>
            <h1>Risk intelligence</h1>
            <p className="muted">Monitor seller relationships and investigate transaction risk.</p>
          </div>
          <div className="topbar-status">
            <span className={`status-dot ${connected ? "online" : ""}`} />
            {connected ? "Systems operational" : health === "checking" ? "Checking systems" : "Backend unavailable"}
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} /> {error}
            <button onClick={() => setError("")} aria-label="Dismiss">×</button>
          </div>
        )}
        {workspaceNotice && (
          <p className="form-success" role="status">{workspaceNotice}</p>
        )}

        <section className="metrics-grid">
          <MetricCard icon={Activity} label="REGISTERED SELLERS" value={sellers.length} detail="Records in seller database" tone="blue" />
          <MetricCard icon={ShieldAlert} label="FLAGGED SELLERS" value={flaggedCount} detail="Marked for investigation" tone="red" />
          <MetricCard icon={Network} label="RISK ENGINE" value="Active" detail="Rule-based assessment" tone="purple" />
          <MetricCard icon={CheckCircle2} label="API STATUS" value={connected ? "Online" : "Offline"} detail={connected ? "Health check passed" : "Check backend server"} tone="green" />
        </section>

        <PaymentsWorkspace sellers={sellers} />

        <div className="content-grid">
          <section className="panel" id="assessment">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">RISK ENGINE</div>
                <h2>Assess risk signals</h2>
                <p className="muted">Select the evidence available for this assessment.</p>
              </div>
              <div className="panel-heading-icon"><Shield size={20} /></div>
            </div>

            <form onSubmit={runAssessment}>

              <label className="auth-field">
                Assess a specific seller
                <select
                  value={riskSellerId}
                  onChange={(event) => setRiskSellerId(event.target.value)}
                >
                  <option value="">General assessment (no seller selected)</option>
                  {sellers.map((seller) => (
                    <option key={seller.sellerId} value={seller.sellerId}>
                      {seller.displayName} ({seller.sellerId})
                    </option>
                  ))}
                </select>
              </label>

              <div className="evidence-list">
                {[
                  ["sharedBeneficiary", "Shared beneficiary", "Connected to a flagged seller through a beneficiary identifier."],
                  ["highTransactionVelocity", "High transaction velocity", "Activity exceeds the configured test threshold."],
                  ["unusualTransactionAmount", "Unusual transaction amount", "Amount exceeds the configured buyer baseline."],
                  ["incompleteSellerVerification", "Incomplete verification", "Seller verification is not complete."],
                ].map(([key, label, description]) => (
                  <label className="evidence-row" key={key}>
                    <input
                      type="checkbox"
                      checked={evidence[key]}
                      onChange={(event) =>
                        setEvidence((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                    />
                    <span className="evidence-copy">
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </div>
              <button className="primary-button" type="submit" disabled={assessmentLoading}>
                {assessmentLoading ? "Assessing..." : <><Gauge size={17} /> Run assessment <ArrowUpRight size={17} /></>}
              </button>
            </form>

            <p className="advisory-notice">
              Decisions are advisory risk signals for analyst review. They do not independently block PayPal or other payment transactions.
            </p>

            {assessment && (
              <div className="assessment-result" aria-live="polite">
                <div className="result-topline">
                  <div className={`result-icon ${assessment.decision.toLowerCase()}`}>
                    <ResultIcon size={22} />
                  </div>
                  <div>
                    <span className="eyebrow">ASSESSMENT RESULT</span>
                    <h3><span className={`decision-label decision-${assessment.decision.toLowerCase()}`}>{assessment.decision}</span></h3>
                  </div>
                  <div className="score-block">
                    <strong>{assessment.score}</strong><small>/100</small>
                  </div>
                </div>
                <div className="score-track"><span style={{ width: `${assessment.score}%` }} /></div>
                <ul className="finding-list">
                  {assessment.findings.map((finding, index) => (
                    <li key={`${finding.rule}-${index}`}>
                      <span>{finding.description}</span>
                      <strong>+{finding.points}</strong>
                    </li>
                  ))}
                  {assessment.findings.length === 0 && <li>No configured risk signals detected.</li>}
                </ul>
                {assessment.assessmentId && (
                  <p className="muted assessment-id">Saved audit ID: {assessment.assessmentId}</p>
                )}
                <p className="disclaimer">{assessment.disclaimer}</p>
              </div>
            )}
          </section>

          <section className="panel" id="investigation">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">SELLER INTELLIGENCE</div>
                <h2>Investigate a seller</h2>
                <p className="muted">Review profile, graph connections, and assessment history.</p>
              </div>
              <div className="panel-heading-icon purple"><Search size={20} /></div>
            </div>

            <form className="search-form" onSubmit={searchSeller}>
              <div className="search-input-wrap">
                <Search size={17} />
                <input
                  value={investigationSellerId}
                  onChange={(event) => setInvestigationSellerId(event.target.value)}
                  placeholder="Enter exact seller ID"
                  aria-label="Seller ID"
                />
              </div>
              <button type="submit" className="secondary-button" disabled={investigationLoading || !investigationSellerId.trim()}>
                {investigationLoading ? "Investigating..." : "Investigate"}
              </button>
            </form>

            {investigation ? (
              <div className="investigation-result">
                <div className="seller-profile">
                  <div className="seller-avatar"><Fingerprint size={24} /></div>
                  <div>
                    <h3>{investigation.seller.displayName}</h3>
                    <small>{investigation.seller.sellerId}</small>
                  </div>
                  <span className={`pill ${investigation.seller.riskStatus.toLowerCase()}`}>
                    {investigation.seller.riskStatus.replace("_", " ")}
                  </span>
                </div>
                <div className="detail-row">
                  <span>Verification</span>
                  <strong>{investigation.seller.verificationStatus}</strong>
                </div>
                <div className="detail-row">
                  <span>Related sellers</span>
                  <strong>{investigation.graph.relatedSellerIds.length}</strong>
                </div>
                <div className="detail-row">
                  <span>Flagged connections</span>
                  <strong className={investigation.graph.flaggedConnectionCount ? "text-danger" : ""}>
                    {investigation.graph.flaggedConnectionCount}
                  </strong>
                </div>
                <div className="related-list">
                  {investigation.graph.relatedSellerIds.map((id) => (
                    <div className="related-item" key={id}>
                      <Network size={15} /> {id}
                    </div>

                  ))}
                  {investigation.graph.relatedSellerIds.length === 0 && (
                    <p className="muted">No shared-beneficiary connections found.</p>
                  )}
                </div>
                <SellerGraph investigation={investigation} />

                {investigation.actionPlan && (
                  <div className="action-plan">
                    <div className="action-plan-heading">
                      <div>
                        <div className="eyebrow">INVESTIGATION ASSISTANT</div>
                        <h3>Recommended actions</h3>
                        <p className="muted">
                          Evidence-based next steps for this seller.
                        </p>
                      </div>
                      <span className="action-count">
                        {investigation.actionPlan.actions.length} actions
                      </span>
                    </div>

                    {investigation.actionPlan.actions.map((action) => (
                      <details
                        className="action-card"
                        key={action.id}
                      >
                        <summary>
                          <div className="action-summary">
                            <span
                              className={`action-priority priority-${action.priority.toLowerCase()}`}
                            >
                              {action.priority}
                            </span>
                            <strong>{action.title}</strong>
                          </div>
                          <ChevronRight size={18} className="action-chevron" />
                        </summary>

                        <div className="action-content">
                          <p>{action.reason}</p>

                          <h4>Supporting evidence</h4>
                          <p className="muted">
                            Evidence type: {action.evidence.type}
                          </p>

                          {action.evidence.connections?.map((connection) => (
                            <div
                              className="action-evidence"
                              key={`${connection.relatedSellerId}-${connection.sharedBeneficiaryIds.join("-")}`}
                            >
                              <strong>
                                Related seller: {connection.relatedSellerId}
                              </strong>
                              <p className="muted">
                                Shared beneficiary IDs:{" "}
                                {connection.sharedBeneficiaryIds.join(", ")}
                              </p>
                            </div>
                          ))}


<h4>Recommended next steps</h4>
<ol>
  {action.recommendedSteps.map((step, index) => (
    <li key={`${action.id}-step-${index}`}>
      {step}
    </li>
  ))}
</ol>

<div className="case-action-controls">
  <button
    type="button"
    className="secondary-button"
    disabled={savingCase}
    onClick={() => handleCreateInvestigationCase(action)}
  >
    {savingCase ? "Saving case..." : "Save as investigation case"}
  </button>
</div>

                        </div>
                      </details>
                    ))}

                    <p className="disclaimer">
                      {investigation.actionPlan.disclaimer}
                    </p>
                  </div>
                )}


<h4>Recent assessments</h4>
                {investigation.recentAssessments.map((item) => (
                  <div className="history-item" key={item._id}>
                    <span className={`decision-label decision-${item.decision.toLowerCase()}`}>{item.decision}</span>
                    <span>Score {item.score}</span>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </div>
                ))}
                <p className="disclaimer">{investigation.investigationDisclaimer}</p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon"><Search size={22} /></div>
                <strong>Ready to investigate</strong>
                <p>Enter a registered seller ID to load its investigation report.</p>
              </div>
            )}
          </section>
        </div>

        <InvestigationCases
          api={api}
          ownerName={sessionUser.name}
          refreshKey={caseRefreshKey}
        />

        <section className="panel seller-panel" id="history">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">AUDIT TRAIL</div>
              <h2>Assessment History</h2>
              <p className="muted">
                Shared assessment history visible to authenticated analysts.
              </p>
            </div>

            <button
              className="icon-button"
              onClick={() => loadAssessmentHistory(historyPagination.page)}
              disabled={historyLoading}
              title="Refresh assessment history"
              aria-label="Refresh assessment history"
            >
              <RefreshCw size={18} className={historyLoading ? "spin" : ""} />
            </button>
          </div>


          <div className="history-filter">
            <label htmlFor="history-seller-filter">
              Filter assessments by seller
            </label>

            <select
              id="history-seller-filter"
              value={historySellerFilter}
              onChange={(event) => {
                const nextFilter = event.target.value;
                setHistorySellerFilter(nextFilter);
                setSelectedHistoryAssessment(null);
              }}
            >
              <option value="">All assessments</option>
              <option value="general">General assessments</option>

              {sellers.map((seller) => (
                <option key={seller.sellerId} value={seller.sellerId}>
                  {seller.displayName} ({seller.sellerId})
                </option>
              ))}
            </select>
          </div>


          {historyError && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              {historyError}
              <button
                onClick={() => setHistoryError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {historyLoading && assessmentHistory.length === 0 && (
            <p className="muted">Loading assessment history...</p>
          )}

          {!historyLoading &&
            !historyError &&
            assessmentHistory.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">
                  <Activity size={22} />
                </div>
                <strong>No assessments yet</strong>
                <p>Run a risk assessment to create your first audit record.</p>
              </div>
            )}

          {assessmentHistory.length > 0 && (
            <div className="assessment-history-list">
              {assessmentHistory.map((item) => (
                <article className="history-item" key={item._id}>
                  <div>
                  <strong><span className={`decision-label decision-${item.decision.toLowerCase()}`}>{item.decision}</span></strong>
                    <p className="muted">
                      {item.targetSellerId || "General risk assessment"}
                    </p>
                  </div>

                  <div>
                    <strong>{item.score}/100</strong>
                    <p className="muted">Risk score</p>
                  </div>

                  <div>
                    <small className="muted">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleString()
                        : "Date unavailable"}
                    </small>

                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setSelectedHistoryAssessment(
                          selectedHistoryAssessment?._id === item._id
                            ? null
                            : item
                        )
                      }
                    >
                      {selectedHistoryAssessment?._id === item._id
                        ? "Hide details"
                        : "View details"}
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  {selectedHistoryAssessment?._id === item._id && (
                    <div className="history-details">
                      <h3>Risk findings</h3>

                      <h4>Evidence submitted</h4>
                      {item.evidence && Object.keys(item.evidence).length > 0 ? (
                        <ul className="evidence-summary">
                          {Object.entries(item.evidence).map(([key, value]) => (
                            <li key={key}><span>{key.replaceAll(/([A-Z])/g, " $1")}</span><strong>{String(value)}</strong></li>
                          ))}
                        </ul>
                      ) : <p className="muted">No evidence details recorded.</p>}

                      {item.findings?.length > 0 ? (
                        <ul className="finding-list">
                          {item.findings.map((finding, index) => (
                            <li key={`${item._id}-finding-${index}`}>
                              <span>{finding.description}</span>
                              <strong>
                                {typeof finding.points === "number"
                                  ? `+${finding.points}`
                                  : ""}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No risk findings recorded.</p>
                      )}

                      <h3>Explanation</h3>

                      {item.explanation?.length > 0 ? (
                        <ul>
                          {item.explanation.map((message, index) => (
                            <li key={`${item._id}-explanation-${index}`}>
                              {message}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">
                          No explanation recorded.
                        </p>
                      )}

                      <p className="muted">
                        Engine version: {item.engineVersion || "Not specified"}
                      </p>

                      <p className="muted">
                        Assessment ID: {item._id}
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          <div className="history-pagination">
            <span className="muted">
              {historyPagination.total} total assessments
              {" · "}Page {historyPagination.page} of{" "}
              {Math.max(1, historyPagination.totalPages)}
            </span>

            <div>
              <button
                type="button"
                className="secondary-button"
                disabled={historyLoading || historyPagination.page <= 1}
                onClick={() =>
                  loadAssessmentHistory(historyPagination.page - 1)
                }
              >
                Previous
              </button>

              <button
                type="button"
                className="secondary-button"
                disabled={
                  historyLoading ||
                  historyPagination.totalPages === 0 ||
                  historyPagination.page >= historyPagination.totalPages
                }
                onClick={() =>
                  loadAssessmentHistory(historyPagination.page + 1)
                }
              >
                Next
              </button>
            </div>
          </div>
        </section>

<section className="panel seller-panel" id="register-seller">
  <div className="panel-heading">
    <div>
      <div className="eyebrow">SELLER MANAGEMENT</div>
      <h2>Register a seller</h2>
      <p className="muted">
        Add a seller record for risk analysis and investigation.
      </p>
    </div>
  </div>

  <form onSubmit={handleRegisterSeller} className="seller-registration-form">
    <label className="auth-field">
      Seller ID
      <input
        value={sellerForm.sellerId}
        onChange={(event) =>
          setSellerForm({ ...sellerForm, sellerId: event.target.value })
        }
        placeholder="e.g. seller-test-002"
        required
      />
    </label>

    <label className="auth-field">
      Display name
      <input
        value={sellerForm.displayName}
        onChange={(event) =>
          setSellerForm({ ...sellerForm, displayName: event.target.value })
        }
        placeholder="e.g. Demo Seller Two"
        required
      />
    </label>

    <label className="auth-field">
      Beneficiary IDs
      <input
        value={sellerForm.beneficiaryIds}
        onChange={(event) =>
          setSellerForm({ ...sellerForm, beneficiaryIds: event.target.value })
        }
        placeholder="Comma-separated IDs (optional)"
      />
    </label>

    <label className="auth-field">
      Verification status
      <select
        value={sellerForm.verificationStatus}
        onChange={(event) =>
          setSellerForm({
            ...sellerForm,
            verificationStatus: event.target.value,
          })
        }
      >
        <option value="UNVERIFIED">Unverified</option>
        <option value="PENDING">Pending</option>
        <option value="VERIFIED">Verified</option>
      </select>
    </label>

    {sellerMessage && (
      <p role="status" className="seller-success">{sellerMessage}</p>
    )}
    {sellerError && (
      <p role="alert" className="auth-error">{sellerError}</p>
    )}

    <button
      className="primary-button"
      type="submit"
      disabled={registeringSeller}
    >
      {registeringSeller ? "Registering…" : "Register seller"}
    </button>
  </form>
</section>

        <section className="panel seller-panel" id="sellers">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">DATABASE</div>
              <h2>Registered sellers</h2>
              <p className="muted">Shared seller records, verification status, and risk status available to all authenticated analysts.</p>
            </div>
            <button className="icon-button refresh-button" onClick={loadDashboard} disabled={loading} aria-label="Refresh sellers">
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          </div>

          {sellers.length ? (
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead>
                  <tr><th>Seller</th><th>Verification</th><th>Risk status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {sellers.map((seller) => (
                    <tr key={seller._id || seller.sellerId}>
                      <td><strong>{seller.displayName}</strong><small>{seller.sellerId}</small></td>
                      <td>{seller.verificationStatus}</td>
                      <td><span className={`pill ${seller.riskStatus.toLowerCase()}`}>{seller.riskStatus.replace("_", " ")}</span></td>
                    <td><button className="text-button" onClick={() => { setInvestigationSellerId(seller.sellerId); document.getElementById("investigation")?.scrollIntoView({ behavior: "smooth" }); }}>Investigate <ArrowUpRight size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-table">
              <Users size={22} />
              <p role={loading ? "status" : undefined}>
                {loading ? "Loading shared seller records..." : connected ? "No sellers registered yet." : "Connect the backend to load seller records."}
              </p>
            </div>
          )}
        </section>

        <footer className="footer">
          <span><Fingerprint size={16} /> TrustMesh AI <span className="footer-separator">/</span> Risk intelligence prototype</span>
          <span><CircleHelp size={15} /> Risk signals support review; they are not proof of fraud.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
