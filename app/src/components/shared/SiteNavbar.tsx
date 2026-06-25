"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AppHeader from "@/components/shared/AppHeader";
import Avatar from "@/components/shared/Avatar";
import NotificationBell from "@/components/shared/NotificationBell";
import { useProfile } from "@/modules/auth/hooks/useProfile";
import { useSignOut } from "@/modules/auth/hooks/useAuth";
import type { AppNotification } from "@/types/collaboration.types";

export default function SiteNavbar() {
  const router = useRouter();
  const [user, setUser] = useState<{
    id: string;
    email?: string;
    user_metadata?: {
      avatar_url?: string;
      picture?: string;
      full_name?: string;
    };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: profile } = useProfile(user?.id);
  const signOut = useSignOut();
  const avatarUrl =
    profile?.avatar_url ?? user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user as any);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user as any);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        setIsMenuOpen(false);
        router.push("/");
      },
    });
  }

  return (
    <nav>
      <div className="app-header">
        <AppHeader />
        <div className="hidden md:flex items-center gap-xl">
          <Link className="nav-link" href="/docs">
            Docs
          </Link>
          <Link className="nav-link" href="/about">
            About
          </Link>
          <a className="nav-link" href="https://github.com" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <div className="flex items-center gap-md">
          {!isLoading && !user ? (
            <Link href="/login" className="btn-primary">
              SIGN IN
            </Link>
          ) : (
            <>
              <NotificationBell
                userId={user?.id}
                onNavigate={(n: AppNotification) => {
                  if (!n.checklist_id) return;
                  const suffix =
                    n.type === "watcher_new_species" && n.payload.watcher_run_id
                      ? `?watcher_run=${n.payload.watcher_run_id}`
                      : "";
                  router.push(`/checklists/${n.checklist_id}${suffix}`);
                }}
              />
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setIsMenuOpen((open) => !open)}
                  className="app-header-avatar"
                >
                  <Avatar src={avatarUrl} iconClassName="text-slate-500 text-xl" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 mt-sm w-48 bg-white border border-outline-variant shadow-lg z-50">
                    <button
                      onClick={() => {
                        setIsMenuOpen(false);
                        router.push("/checklists");
                      }}
                      className="w-full text-left px-md py-sm font-code-md text-code-md text-on-surface hover:bg-surface-container-low transition-colors"
                    >
                      My Checklists
                    </button>
                    <button
                      onClick={handleSignOut}
                      disabled={signOut.isPending}
                      className="w-full text-left px-md py-sm font-code-md text-code-md text-primary hover:bg-surface-container-low transition-colors disabled:opacity-50"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
