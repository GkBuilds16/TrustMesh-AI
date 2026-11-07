
import { useState } from "react";
import { ShieldCheck, Eye, EyeOff, ArrowRight } from "lucide-react";
import { login, register } from "./services/auth";
import "./Auth.css";

export default function Auth({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (new TextEncoder().encode(password).length > 72) {
      setError("Password must be no more than 72 UTF-8 bytes.");
      return;
    }
    setLoading(true);

    try {
      const result = isRegister
        ? await register(name, email, password)
        : await login(email, password);

      onLogin(result);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-brand-icon">
          <ShieldCheck size={32} />
        </div>

        <h1>TrustMesh AI</h1>
        <p>
          Intelligent transaction risk analysis.
          <br />
          Evidence-driven decisions. Explainable security.
        </p>

        <div className="auth-feature">
          <ShieldCheck size={18} />
          <span>Explainable risk assessment</span>
        </div>
        <div className="auth-feature">
          <ShieldCheck size={18} />
          <span>Seller network investigation</span>
        </div>
        <div className="auth-feature">
          <ShieldCheck size={18} />
          <span>Secure, authenticated access</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-eyebrow">
            TRUSTMESH SECURITY PLATFORM
          </div>

          <h2>{isRegister ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-subtitle">
            {isRegister
              ? "Register to access your risk analysis workspace."
              : "Sign in to continue to your security workspace."}
          </p>

          <div className="auth-switch">
            <button
              type="button"
              className={!isRegister ? "active" : ""}
              onClick={() => {
                setIsRegister(false);
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={isRegister ? "active" : ""}
              onClick={() => {
                setIsRegister(true);
                setError("");
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {isRegister && (
              <label className="auth-field">
                Full name
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your full name"
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  required
                />
              </label>
            )}

            <label className="auth-field">
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="auth-field">
              Password
              <span className="auth-password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={
                    isRegister ? "At least 12 characters" : "Enter your password"
                  }
                  minLength={isRegister ? 12 : undefined}
                  aria-describedby="password-byte-limit"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
              <small id="password-byte-limit" className="password-hint">
                Passwords can contain at most 72 UTF-8 bytes. Current: {new TextEncoder().encode(password).length}/72.
              </small>
            </label>

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            <button
              className="auth-submit"
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : isRegister
                  ? "Create account"
                  : "Sign in"}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <p className="auth-footer">
            Access is intended for authorized TrustMesh AI users.
          </p>
        </div>
      </section>
    </main>
  );
}
