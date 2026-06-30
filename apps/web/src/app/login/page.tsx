"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Login failed");
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Unable to reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-circle">
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path d="M6.6 3.5h2.5l1.2 3.2-1.8 1.4a12 12 0 0 0 3.6 3.6l1.4-1.8 3.2 1.2v2.5c0 .8-.7 1.5-1.5 1.5A11.4 11.4 0 0 1 3.5 5c0-.8.7-1.5 1.5-1.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <span className="login-brand-name">VoiceOps Control</span>
        </div>
        <h1 className="login-title">Sign in to your workspace</h1>
        <p className="login-sub">BPO supervisor and agent portal</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">
            <span>Username</span>
            <input
              className="login-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="supervisor"
              autoComplete="username"
              required
            />
          </label>
          <label className="login-label">
            <span>Password</span>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
