"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useSignOut,
  useUpdatePassword,
  useVerifyPasswordResetToken,
} from "@/modules/auth/hooks/useAuth";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { PartyBlast } from "@/components/shared/PartyBlast";

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-modal="true">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-gutter overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white border border-outline-variant p-lg sm:p-xl hard-shadow my-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <ModalShell>
          <p className="text-base text-on-surface-variant text-center">Loading...</p>
        </ModalShell>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get("token_hash");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const updatePassword = useUpdatePassword();
  const verifyToken = useVerifyPasswordResetToken();
  const signOut = useSignOut();
  // verifyOtp establishes a session for this user — read their email off it
  // so we can hand it back to the login page pre-filled, then sign out
  // immediately after the password update so they have to actually sign in
  // with the new password rather than landing in the app already logged in.
  // Captured into a ref during render (not state-in-effect) the moment it's
  // available, since signOut() invalidates this same query and wipes it.
  const { data: currentUser } = useCurrentUser();
  const userEmailRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentUser?.email) userEmailRef.current = currentUser.email;
  }, [currentUser]);

  useEffect(() => {
    if (!tokenHash) return;
    verifyToken.mutate(tokenHash);
    // Runs once per mount — the token is single-use, so re-verifying on every render would burn it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenHash]);

  function handleInvalid(e: React.InvalidEvent<HTMLInputElement>) {
    e.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMismatchError(null);

    if (password !== confirmPassword) {
      setMismatchError("Passwords do not match.");
      return;
    }

    updatePassword.mutate(password, {
      onSuccess: () => {
        setShowSuccess(true);
        signOut.mutate();
      },
    });
  }

  function continueToSignIn() {
    const userEmail = userEmailRef.current;
    router.push(userEmail ? `/login?email=${encodeURIComponent(userEmail)}` : "/login");
  }

  if (!tokenHash || verifyToken.isError) {
    return (
      <ModalShell>
        <div className="text-center">
          <Link
            href="/"
            className="font-headline-md text-headline-md font-bold text-primary mb-2 block"
          >
            Checklist Hub
          </Link>
          <span className="material-symbols-outlined text-red-600 text-[40px] mb-md block">
            error
          </span>
          <h1 className="font-headline-md text-headline-md text-on-surface mb-2">
            This link is invalid or has expired
          </h1>
          <p className="text-base text-on-surface-variant mb-xl">
            Password reset links can only be used once and expire after a while. Request a new
            one from the sign-in page.
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full bg-primary-container text-on-primary py-3 font-headline-md text-base font-bold hard-shadow hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
          >
            Back to sign in
          </button>
        </div>
      </ModalShell>
    );
  }

  if (verifyToken.isPending || !verifyToken.isSuccess) {
    return (
      <ModalShell>
        <p className="text-base text-on-surface-variant text-center">Verifying your link...</p>
      </ModalShell>
    );
  }

  if (showSuccess) {
    return (
      <div data-modal="true">
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-gutter overflow-y-auto">
          <div className="relative w-full max-w-[440px] bg-white border border-outline-variant p-lg sm:p-xl hard-shadow my-auto overflow-hidden animate-dialog-pop-in">
            <PartyBlast />
            <div className="relative z-10 text-center py-xl">
              <span className="material-symbols-outlined text-primary text-[48px] mb-md block">
                check_circle
              </span>
              <h1 className="font-headline-md text-headline-md text-on-surface mb-2">
                Password updated!
              </h1>
              <p className="text-base text-on-surface-variant mb-xl">
                Your password has been changed successfully. Sign in with your new password to
                continue.
              </p>
              <button
                type="button"
                onClick={continueToSignIn}
                className="w-full bg-primary-container text-on-primary py-3 font-headline-md text-base font-bold hard-shadow hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
              >
                Continue to sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ModalShell>
      <div className="text-center mb-lg sm:mb-xl">
        <Link
          href="/"
          className="font-headline-md text-headline-md font-bold text-primary mb-2 block"
        >
          Checklist Hub
        </Link>
        <h1 className="font-headline-md text-headline-md text-on-surface">
          Set a new password
        </h1>
      </div>

      <form className="flex flex-col gap-lg" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <label className="form-label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            onInvalid={handleInvalid}
            className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="form-label" htmlFor="confirm-password">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            minLength={6}
            onInvalid={handleInvalid}
            className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {mismatchError && <p className="text-base text-red-600">{mismatchError}</p>}
        {updatePassword.error && (
          <p className="text-base text-red-600">{(updatePassword.error as Error).message}</p>
        )}

        <button
          type="submit"
          disabled={updatePassword.isPending}
          className="w-full bg-primary-container text-on-primary py-3 font-headline-md text-base font-bold hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
        >
          {updatePassword.isPending ? "Updating..." : "Update password"}
        </button>
      </form>
    </ModalShell>
  );
}
