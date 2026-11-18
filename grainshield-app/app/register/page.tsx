"use client";

import { useState, useRef, type FormEvent, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wheat,
  Eye,
  EyeOff,
  Upload,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

type Step = "details" | "otp" | "kyc" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "details", label: "Account" },
  { key: "otp", label: "Verify" },
  { key: "kyc", label: "Documents" },
  { key: "done", label: "Complete" },
];

interface KycFile {
  name: string;
  file: File;
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [kycFiles, setKycFiles] = useState<Record<string, KycFile | null>>({
    nationalId: null,
    selfie: null,
    proofOfResidence: null,
  });

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  async function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!fullName.trim() || !phone.trim() || !email.trim() || !password.trim()) {
      setError("All fields are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Registration failed" }));
        throw new Error(body.error ?? "Registration failed");
      }
      setStep("otp");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Registration failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, key: string) {
    if (key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Enter the full 6-digit code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Verification failed" }));
        throw new Error(body.error ?? "Verification failed");
      }
      setStep("kyc");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Verification failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(key: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setKycFiles((prev) => ({ ...prev, [key]: { name: file.name, file } }));
  }

  async function handleKycSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!kycFiles.nationalId) {
      setError("National ID / Passport is required.");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      Object.entries(kycFiles).forEach(([key, val]) => {
        if (val) formData.append(key, val.file);
      });
      formData.append("email", email);

      const res = await fetch("/api/kyc/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(body.error ?? "Upload failed");
      }
      setStep("done");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    setError("");
    setLoading(true);
    try {
      await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setError("");
    } catch {
      setError("Failed to resend code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#F3F4F1" }}>
      {/* Left — image */}
      <div className="hidden lg:block lg:w-[42%] relative overflow-hidden">
        <img
          src="/images/pexels-david-lago-rodriguez-84330347-12600062.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: "brightness(0.82) saturate(0.9)" }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.2) 100%)" }} />
        <div className="relative z-10 flex flex-col justify-end h-full p-8 pb-10">
          <p className="text-[10px] tracking-[0.08em] uppercase text-white/50 mb-1.5">
            Registration
          </p>
          <p className="text-[15px] font-semibold text-white/85 leading-snug max-w-xs">
            Grain storage and warehouse receipt finance
          </p>
          <p className="text-[12px] text-white/45 max-w-xs leading-relaxed mt-1.5">
            Takes a few minutes. Full access after document verification.
          </p>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10">
        <div className="w-full max-w-md mx-auto">
          <Link href="/" className="flex items-center gap-2 mb-6">
            <Wheat style={{ width: 15, height: 15 }} className="text-brand-700" />
            <span className="text-[13.5px] font-semibold text-ink tracking-[-0.01em]">GrainShield</span>
          </Link>

          {/* Progress — flat, minimal */}
          <div className="flex items-center gap-1 mb-6">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <div className="flex items-center gap-1">
                  <div
                    className={`w-5 h-5 flex items-center justify-center text-2xs font-semibold ${
                      i < currentStepIndex
                        ? "bg-brand-600 text-white"
                        : i === currentStepIndex
                          ? "bg-ink text-white"
                          : "bg-surface-sunken text-ink-muted"
                    }`}
                  >
                    {i < currentStepIndex ? (
                      <CheckCircle2 style={{ width: 12, height: 12 }} />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`text-2xs font-medium hidden sm:inline ${
                    i <= currentStepIndex ? "text-ink-secondary" : "text-ink-muted"
                  }`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-5 h-px mx-0.5 ${i < currentStepIndex ? "bg-brand-400" : "bg-border"}`} />
                )}
              </div>
            ))}
          </div>

          {step === "details" && (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-ink tracking-[-0.01em]">Create Account</h1>
                <p className="text-xs text-ink-tertiary mt-0.5">
                  Provide your details to open an account.
                </p>
              </div>

              <form onSubmit={handleDetailsSubmit} className="space-y-3.5" noValidate>
                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium text-ink-secondary mb-1">
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => { setFullName(e.target.value); setError(""); }}
                    required
                    className="input-field"
                    placeholder="John Kiprotich"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-ink-secondary mb-1">
                    Phone Number
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); setError(""); }}
                    required
                    className="input-field"
                    placeholder="0712 345 678"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-ink-secondary mb-1">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    required
                    className="input-field"
                    placeholder="john.kiprotich@gmail.com"
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
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      required
                      className="input-field pr-10"
                      placeholder="Min. 8 characters"
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
                </div>

                {error && <ErrorBanner message={error} />}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2"
                >
                  {loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <ArrowRight style={{ width: 14, height: 14 }} />}
                  {loading ? "Creating Account..." : "Continue"}
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-ink-tertiary">
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-brand-700 hover:text-brand-800 transition-colors">
                  Sign In
                </Link>
              </p>
            </>
          )}

          {step === "otp" && (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-ink tracking-[-0.01em]">Verify Email</h1>
                <p className="text-xs text-ink-tertiary mt-0.5">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-medium text-ink-secondary">{email}</span>
                </p>
              </div>

              <form onSubmit={handleOtpSubmit} className="space-y-5" noValidate>
                <div className="flex items-center justify-center gap-2">
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e.key)}
                      className="w-10 h-10 text-center text-base font-semibold text-ink input-field"
                      aria-label={`Digit ${i + 1}`}
                    />
                  ))}
                </div>

                {error && <ErrorBanner message={error} />}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2"
                >
                  {loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : null}
                  {loading ? "Verifying..." : "Verify Code"}
                </button>

                <p className="text-center text-xs text-ink-tertiary">
                  Didn&apos;t receive it?{" "}
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={loading}
                    className="font-medium text-brand-700 hover:text-brand-800 disabled:opacity-50 transition-colors"
                  >
                    Resend Code
                  </button>
                </p>
              </form>

              <button
                type="button"
                onClick={() => setStep("details")}
                className="mt-5 flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink-secondary transition-colors"
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Back
              </button>
            </>
          )}

          {step === "kyc" && (
            <>
              <div className="mb-5">
                <h1 className="text-lg font-semibold text-ink tracking-[-0.01em]">Upload Documents</h1>
                <p className="text-xs text-ink-tertiary mt-0.5">
                  Clear copies of identification documents. Required for account verification.
                </p>
              </div>

              <form onSubmit={handleKycSubmit} className="space-y-3.5" noValidate>
                <FileUploadField
                  id="nationalId"
                  label="National ID / Passport"
                  required
                  file={kycFiles.nationalId}
                  onChange={(e) => handleFileChange("nationalId", e)}
                />
                <FileUploadField
                  id="selfie"
                  label="Selfie Photo"
                  file={kycFiles.selfie}
                  onChange={(e) => handleFileChange("selfie", e)}
                />
                <FileUploadField
                  id="proofOfResidence"
                  label="Proof of Residence"
                  file={kycFiles.proofOfResidence}
                  onChange={(e) => handleFileChange("proofOfResidence", e)}
                />

                {error && <ErrorBanner message={error} />}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2"
                >
                  {loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : null}
                  {loading ? "Uploading..." : "Submit for Review"}
                </button>
              </form>

              <button
                type="button"
                onClick={() => setStep("otp")}
                className="mt-5 flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink-secondary transition-colors"
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Back
              </button>
            </>
          )}

          {step === "done" && (
            <div className="py-3">
              <div className="w-10 h-10 bg-brand-50 flex items-center justify-center mb-4">
                <CheckCircle2 style={{ width: 20, height: 20 }} className="text-brand-600" />
              </div>
              <h1 className="text-lg font-semibold text-ink tracking-[-0.01em] mb-1.5">
                Registration complete
              </h1>
              <p className="text-xs text-ink-tertiary mb-1">
                Account created. Documents submitted for review.
              </p>
              <p className="text-xs text-ink-tertiary mb-6">
                Sign in now. Some features require KYC approval.
              </p>
              <button
                onClick={() => router.push("/login")}
                className="btn-primary w-full py-2"
              >
                Sign In
              </button>
              <p className="text-[10px] text-ink-muted text-center mt-3">
                Also available via USSD *384#
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-status-danger bg-status-danger-surface px-3 py-2" role="alert">
      <AlertCircle style={{ width: 14, height: 14 }} className="flex-shrink-0 mt-0.5" />
      {message}
    </div>
  );
}

function FileUploadField({
  id,
  label,
  required,
  file,
  onChange,
}: {
  id: string;
  label: string;
  required?: boolean;
  file: KycFile | null;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink-secondary mb-1">
        {label}
        {required && <span className="text-status-danger ml-0.5">*</span>}
      </label>
      <label
        htmlFor={id}
        className={`flex items-center gap-2.5 border px-3 py-2.5 cursor-pointer transition-colors ${
          file
            ? "border-brand-300 bg-brand-50"
            : "border-border border-dashed hover:border-border-strong bg-white"
        }`}
      >
        {file ? (
          <>
            <CheckCircle2 style={{ width: 15, height: 15 }} className="text-brand-600 flex-shrink-0" />
            <span className="text-sm text-ink truncate">{file.name}</span>
          </>
        ) : (
          <>
            <Upload style={{ width: 15, height: 15 }} className="text-ink-muted flex-shrink-0" />
            <span className="text-sm text-ink-tertiary">Click to upload</span>
          </>
        )}
        <input
          id={id}
          type="file"
          accept="image/*,.pdf"
          onChange={onChange}
          className="sr-only"
        />
      </label>
    </div>
  );
}
