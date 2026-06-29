import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useCurrentUser() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["auth", "current-user"],
    queryFn: async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) throw error;
      return user;
    },
  });
}
