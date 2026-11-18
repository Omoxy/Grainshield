"use client";

import { Suspense, useState, useCallback, type FormEvent, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { login, getHomePage } from "@/lib/auth/client";
import type { AuthUser } from "@/lib/auth/types";
import Link from "next/link";
import { Wheat, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);

      try {
        const response = await login(identifier, password);
        const user: AuthUser = response.user;
        setSuccess(true);
        setTimeout(() => {
          const destination = redirectTo ?? getHomePage(user);
          router.push(destination);
        }, 400);
      } catch {
        setError("Invalid credentials. Check your details and try again.");
      } finally {
        if (!success) setLoading(false);
      }
    },
    [identifier, password, redirectTo, router, success],
  );

  return (
    <div className="min-h-screen flex" style={{ background: "#F3F4F1" }}>
      {/* Left — image, not cinematic */}
      <div className="hidden lg:block lg:w-[42%] relative overflow-hidden">
        <img
          src="/images/pexels-rakibul-alam-khan-2154391542-33762316.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "brightness(0.82) saturate(0.9)" }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.2) 100%)" }} />
        <div className="relative z-10 flex flex-col justify-end h-full p-8 pb-10">
          <p className="text-[10px] tracking-[0.08em] uppercase text-white/50 mb-1.5">
            Uasin Gishu &middot; Trans Nzoia
          </p>
          <p className="text-[15px] font-semibold text-white/85 leading-snug max-w-xs">
            Grain storage, protection, and warehouse receipt finance
          </p>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10">
        <div className="w-full max-w-sm mx-auto">
          <Link href="/" className="flex items-center gap-2 mb-8">
            <Wheat style={{ width: 15, height: 15 }} className="text-brand-700" />
            <span className="text-[13.5px] font-semibold text-ink tracking-[-0.01em]">GrainShield</span>
          </Link>

          <div className="mb-5">
            <h1 className="text-lg font-semibold text-ink tracking-[-0.01em]">Sign in</h1>
            <p className="text-xs text-ink-tertiary mt-0.5">
              Enter your credentials to continue.
            </p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-3.5" noValidate>
            <div>
              <label htmlFor="identifier" className="block text-sm font-medium text-ink-secondary mb-1">
                Phone Number or Email
              </label>
              <input
                id="identifier"
                type="text"
                inputMode="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setError(""); }}
                required
                aria-invalid={!!error}
                className="input-field"
                placeholder="0712 345 678"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink-secondary mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  required
                  aria-invalid={!!error}
                  className="input-field pr-10"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-secondary transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
                </button>
              </div>
              <div className="mt-1 text-right">
                <button type="button" className="link-action text-[11px]">
                  Forgot Password?
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-status-danger bg-status-danger-surface px-3 py-2" role="alert">
                <AlertCircle style={{ width: 14, height: 14 }} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || success}
              className="btn-primary w-full py-2"
            >
              {success ? "Redirecting..." : loading ? (
                <><Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Signing in...</>
              ) : "Sign In"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-tertiary">
            No account yet?{" "}
            <Link href="/register" className="font-medium text-brand-700 hover:text-brand-800 transition-colors">
              Create Account
            </Link>
          </p>

          <div className="mt-8 pt-4 border-t border-border-subtle flex items-center justify-center gap-3 text-[10px] text-ink-faint tracking-wide">
            <span>USSD *384#</span>
            <span>SMS Alerts</span>
            <span>M-Pesa</span>
          </div>
        </div>
      </div>
    </div>
  );
}
