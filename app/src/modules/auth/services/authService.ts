import type { Provider } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/collaboration.types";

function getRedirectUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

export async function signInWithProvider(provider: Provider) {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: getRedirectUrl() },
  });
  if (error) throw error;
}

export async function checkEmailExists(email: string): Promise<boolean> {
  const res = await fetch("/api/auth/check-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Could not verify email. Please try again.");
  const { exists } = (await res.json()) as { exists: boolean };
  return exists;
}

export async function signInWithEmail(email: string, password: string) {
  const exists = await checkEmailExists(email);
  if (!exists) {
    throw new Error("No account found with this email. Please sign up.");
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Incorrect password. Please try again.");
}

export async function signUpWithEmail(email: string, password: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: getRedirectUrl() },
  });
  if (error) throw error;
}

export async function resetPasswordForEmail(email: string) {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Could not send reset email. Please try again.");
}

/**
 * Consumes the one-time `token_hash` from the password-reset email link,
 * establishing a session so `updatePassword` can run next. See the comment
 * in /api/auth/forgot-password/route.ts for why the link points here instead
 * of Supabase's hosted verify-and-redirect URL.
 */
export async function verifyPasswordResetToken(tokenHash: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  const supabase = createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(
  userId: string,
  updates: Partial<
    Pick<Profile, "full_name" | "profession" | "location" | "institution" | "designation">
  >,
): Promise<Profile> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      email: user?.email ?? null,
      avatar_url: user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture ?? null,
      full_name: user?.user_metadata?.full_name ?? null,
      ...updates,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Profile;
}
