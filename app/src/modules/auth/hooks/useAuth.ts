import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  signInWithEmail,
  signInWithProvider,
  signOut,
  signUpWithEmail,
} from "../services/authService";

export function useSignInWithProvider() {
  return useMutation({ mutationFn: signInWithProvider });
}

export function useSignInWithEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      signInWithEmail(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "current-user"] });
    },
  });
}

export function useSignUpWithEmail() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      signUpWithEmail(email, password),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "current-user"] });
    },
  });
}
