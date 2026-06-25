import { usePresenceStore } from "../stores/presenceStore";

/** Read-only access to the current checklist's live presence state. */
export function usePresence() {
  return usePresenceStore((state) => state.participants);
}
