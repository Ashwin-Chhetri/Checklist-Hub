import { create } from "zustand";
import type { PresenceState } from "@/types/collaboration.types";

interface PresenceStoreState {
  /** Keyed by user_id */
  participants: Record<string, PresenceState>;
  setParticipants: (participants: Record<string, PresenceState>) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceStoreState>((set) => ({
  participants: {},
  setParticipants: (participants) => set({ participants }),
  clear: () => set({ participants: {} }),
}));
