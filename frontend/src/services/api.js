
const API_BASE_URL =
  import.meta.env?.VITE_API_BASE_URL || "http://localhost:5000/api";

async function request(path, options = {}) {
  const token = sessionStorage.getItem("trustmesh_token");

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  // The health endpoint is public. Other API requests can use the token
  // when one is available.
  if (token && path !== "/health") {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Preserve the HTTP status when a proxy or server returns a non-JSON error.
  }

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem("trustmesh_token");
      sessionStorage.removeItem("trustmesh_user");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("trustmesh:unauthorized"));
      }
      throw new Error(
        "Your session is invalid or expired. Please sign in again."
      );
    }

    throw new Error(data.message || `Request failed: ${response.status}`);
  }

  return data;
}

export const api = {
  getHealth: () => request("/health"),



getAssessmentHistory: (page = 1, limit = 10, targetSellerId = "") => {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  if (targetSellerId) {
    params.set("targetSellerId", targetSellerId);
  }

  return request(`/risk/assessments?${params.toString()}`);
},


  getSellers: () => request("/sellers"),

  getPayments: () => request("/payments"),

  getPaymentReviewQueue: () => request("/payments/review-queue"),

  createPayment: (payment, idempotencyKey) =>
    request("/payments", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payment),
    }),

  getPayment: (paymentId) =>
    request(`/payments/${encodeURIComponent(paymentId)}`),

  capturePayment: (paymentId) =>
    request(`/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST" }),

  cancelPayment: (paymentId) =>
    request(`/payments/${encodeURIComponent(paymentId)}/cancel`, { method: "POST" }),

  investigateSeller: (sellerId) =>
    request(`/sellers/${encodeURIComponent(sellerId)}/investigation`),

  getSellerHistory: (sellerId) =>
    request(`/risk/sellers/${encodeURIComponent(sellerId)}/history`),


evaluateRisk: (evidence, targetSellerId) =>
  request("/risk/evaluate", {
    method: "POST",
    body: JSON.stringify({
      evidence,
      ...(targetSellerId ? { targetSellerId } : {}),
    }),
  }),


      registerSeller: (seller) =>
    request("/sellers", {
      method: "POST",
      body: JSON.stringify(seller),
    }),


  getInvestigationCases: (sellerId = "", status = "") => {
    const params = new URLSearchParams();

    if (sellerId) params.set("sellerId", sellerId);
    if (status) params.set("status", status);

    const query = params.toString();

    return request(
      `/investigation-cases${query ? `?${query}` : ""}`
    );
  },

  createInvestigationCase: (sellerId, action) =>
    request("/investigation-cases", {
      method: "POST",
      body: JSON.stringify({ sellerId, action }),
    }),

  updateInvestigationCase: (caseId, status, resolutionNotes) =>
    request(`/investigation-cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, resolutionNotes }),
    }),


  getInvestigationCaseAudit: (caseId) =>
    request(
      `/investigation-cases/${encodeURIComponent(caseId)}/audit`
    ),


};
