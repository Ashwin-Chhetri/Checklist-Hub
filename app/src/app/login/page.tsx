"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Provider } from "@supabase/supabase-js";
import {
  useResetPasswordForEmail,
  useSignInWithEmail,
  useSignInWithProvider,
  useSignUpWithEmail,
} from "@/modules/auth/hooks/useAuth";
import { PartyBlast } from "@/components/shared/PartyBlast";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [signUpMessage, setSignUpMessage] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const signInWithProvider = useSignInWithProvider();
  const signInWithEmail = useSignInWithEmail();
  const signUpWithEmail = useSignUpWithEmail();
  const resetPassword = useResetPasswordForEmail();

  const error =
    mode === "sign_in"
      ? signInWithEmail.error ?? signInWithProvider.error
      : signUpWithEmail.error ?? signInWithProvider.error;
  const isPending =
    signInWithEmail.isPending || signUpWithEmail.isPending || signInWithProvider.isPending;

  function handleInvalid(e: React.InvalidEvent<HTMLInputElement>) {
    e.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function switchMode(next: "sign_in" | "sign_up") {
    setMode(next);
    setSignUpMessage(null);
    signInWithEmail.reset();
    signUpWithEmail.reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSignUpMessage(null);

    if (mode === "sign_in") {
      signInWithEmail.mutate(
        { email, password },
        { onSuccess: () => router.push("/checklists") },
      );
    } else {
      signUpWithEmail.mutate(
        { email, password },
        {
          onSuccess: () =>
            setSignUpMessage("Sign up successful! Check your email to confirm your account."),
        },
      );
    }
  }

  function openForgotPassword() {
    resetPassword.reset();
    setShowForgotPassword(true);
  }

  function handleForgotPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    resetPassword.mutate(email);
  }

  return (
    <div data-modal="true">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-gutter overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white border border-outline-variant p-lg sm:p-xl hard-shadow my-auto">
          <div className="text-center mb-lg sm:mb-xl">
            <Link
              href="/"
              className="font-headline-md text-headline-md font-bold text-primary mb-2 block"
            >
              Checklist Hub
            </Link>
            <h1 className="font-headline-md text-headline-md text-on-surface">
              {mode === "sign_in" ? "Sign in to your account" : "Create your account"}
            </h1>
          </div>

          <div className="flex flex-col gap-2 mb-lg">
            <button
              type="button"
              onClick={() => signInWithProvider.mutate("google" as Provider)}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-outline font-body-sm text-base font-medium text-on-surface hover:bg-surface-container-low transition-colors disabled:opacity-50"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>

              Sign in with Google
            </button>
            <button
              type="button"
              disabled
              title="ORCID sign-in is coming soon"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-outline font-body-sm text-base font-medium text-on-surface opacity-50 cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">school</span>
              Sign in with ORCID
              <span className="font-label-caps text-[9px] uppercase tracking-wider text-on-surface-variant">
                Soon
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 mb-lg">
            <div className="h-px flex-1 bg-outline-variant" />
            <span className="text-sm font-semibold text-on-surface-variant">
              Or continue with email
            </span>
            <div className="h-px flex-1 bg-outline-variant" />
          </div>

          <form className="flex flex-col gap-lg" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1">
              <label
                className="form-label"
                htmlFor="email"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                onInvalid={handleInvalid}
                placeholder="engineer@checklist.hub"
                className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none placeholder:text-surface-dim"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-baseline">
                <label
                  className="form-label"
                  htmlFor="password"
                >
                  Password
                </label>
                {mode === "sign_in" && (
                  <button
                    type="button"
                    disabled={!email}
                    title={!email ? "Enter your email address first" : undefined}
                    className="text-base text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                    onClick={openForgotPassword}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                onInvalid={handleInvalid}
                className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="text-base text-red-600">{(error as Error).message}</p>}
            {signUpMessage && <p className="text-base text-primary">{signUpMessage}</p>}

            <button
              type="submit"
              disabled={isPending}
              className="w-full bg-primary-container text-on-primary py-3 font-headline-md text-base font-bold hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
            >
              {mode === "sign_in" ? "Sign In" : "Sign Up"}
            </button>
          </form>

          <div className="mt-xl text-center">
            <p className="text-base text-on-surface-variant">
              {mode === "sign_in" ? "Don't have an account? " : "Already have an account? "}
              <button
                type="button"
                className="text-primary font-bold hover:underline"
                onClick={() => switchMode(mode === "sign_in" ? "sign_up" : "sign_in")}
              >
                {mode === "sign_in" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>

      {showForgotPassword && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowForgotPassword(false)}
        >
          <div
            className={`relative w-full max-w-[400px] bg-white border border-outline-variant p-lg hard-shadow overflow-hidden ${resetPassword.isSuccess ? "animate-dialog-pop-in" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            {resetPassword.isSuccess && <PartyBlast />}

            <div className="relative z-10 flex items-center justify-between mb-md">
              <h2 className="font-headline-md text-headline-md text-on-surface">
                Reset your password
              </h2>
              <button
                onClick={() => setShowForgotPassword(false)}
                className="text-on-surface-variant hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {resetPassword.isSuccess ? (
              <div className="relative text-center py-md">
                <span className="material-symbols-outlined text-primary text-[40px] mb-sm block">
                  mark_email_read
                </span>
                <p className="text-base text-primary">
                  Check your email for a link to reset your password.
                </p>
              </div>
            ) : (
              <form className="relative flex flex-col gap-md" onSubmit={handleForgotPasswordSubmit}>
                <p className="text-base text-on-surface-variant">
                  We&apos;ll send a password reset link to the email below.
                </p>
                <div className="flex flex-col gap-1">
                  <span className="form-label">Email address</span>
                  <p className="w-full bg-surface-container-low border border-outline-variant px-4 py-2.5 text-base text-on-surface">
                    {email}
                  </p>
                </div>
                {resetPassword.error && (
                  <p className="text-base text-red-600">{(resetPassword.error as Error).message}</p>
                )}
                <button
                  type="submit"
                  disabled={resetPassword.isPending}
                  className="w-full bg-primary-container text-on-primary py-3 font-headline-md text-base font-bold hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
                >
                  {resetPassword.isPending ? "Sending..." : "Send reset link"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
