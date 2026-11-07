
const API_BASE =
  import.meta.env?.VITE_API_BASE_URL || "http://localhost:5000/api";

async function authRequest(endpoint, payload) {
  const response = await fetch(`${API_BASE}/auth/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Keep the public authentication error generic for non-JSON responses.
  }

  if (!response.ok) {
    throw new Error(data.message || "Authentication request failed.");
  }

  return data;
}

export function register(name, email, password) {
  return authRequest("register", { name, email, password });
}

export function login(email, password) {
  return authRequest("login", { email, password });
}
