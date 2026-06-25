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

export async function signInWithEmail(email: string, password: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
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
