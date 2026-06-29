import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  resetPasswordForEmail,
  signInWithEmail,
  signInWithProvider,
  signOut,
  signUpWithEmail,
  updatePassword,
  verifyPasswordResetToken,
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

export function useResetPasswordForEmail() {
  return useMutation({ mutationFn: resetPasswordForEmail });
}

export function useUpdatePassword() {
  return useMutation({ mutationFn: updatePassword });
}

export function useVerifyPasswordResetToken() {
  return useMutation({ mutationFn: verifyPasswordResetToken });
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
