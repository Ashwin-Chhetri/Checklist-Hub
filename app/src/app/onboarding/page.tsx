"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/modules/auth/hooks/useCurrentUser";
import { useUpdateProfile } from "@/modules/auth/hooks/useProfile";
import { useSignOut } from "@/modules/auth/hooks/useAuth";
import Avatar from "@/components/shared/Avatar";

const PROFESSIONS = [
  { value: "taxonomist", label: "Taxonomist" },
  { value: "researcher", label: "Researcher" },
  { value: "conservationist", label: "Conservationist" },
  { value: "student", label: "Student" },
  { value: "other", label: "Other (specify)" },
];

const DESIGNATIONS = [
  { value: "dr", label: "Dr" },
  { value: "prof", label: "Prof" },
  { value: "mr", label: "Mr" },
  { value: "mrs", label: "Mrs" },
  { value: "ms", label: "Ms" },
  { value: "other", label: "Other (specify)" },
];

interface LocationSuggestion {
  name: string;
  display_name: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const updateProfile = useUpdateProfile(user?.id);
  const signOut = useSignOut();

  function handleCancel() {
    signOut.mutate(undefined, {
      onSuccess: () => router.push("/"),
    });
  }

  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [customDesignation, setCustomDesignation] = useState("");
  const [profession, setProfession] = useState("");
  const [customProfession, setCustomProfession] = useState("");
  const [institution, setInstitution] = useState("");
  const [location, setLocation] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const skipNextLocationFetch = useRef(false);

  useEffect(() => {
    if (skipNextLocationFetch.current) {
      skipNextLocationFetch.current = false;
      return;
    }

    if (location.length < 2) {
      setLocationSuggestions([]);
      setShowLocationSuggestions(false);
      return;
    }

    setIsLoadingLocations(true);
    const timer = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=5`,
      )
        .then((res) => res.json())
        .then((data) => {
          const suggestions = data.map(
            (item: { name: string; display_name: string }) => ({
              name: item.name,
              display_name: item.display_name,
            }),
          );
          setLocationSuggestions(suggestions);
          setShowLocationSuggestions(true);
          setIsLoadingLocations(false);
        })
        .catch(() => {
          setLocationSuggestions([]);
          setIsLoadingLocations(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [location]);

  useEffect(() => {
    if (user?.user_metadata?.full_name) {
      setFullName(user.user_metadata.full_name);
    }
  }, [user]);

  function handleInvalid(e: React.InvalidEvent<HTMLInputElement | HTMLSelectElement>) {
    e.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalDesignation =
      designation === "other" ? customDesignation : designation;
    const finalProfession =
      profession === "other" ? customProfession : profession;

    updateProfile.mutate(
      {
        full_name: fullName || null,
        designation: finalDesignation || null,
        profession: finalProfession || null,
        institution: institution || null,
        location: location || null,
      },
      { onSuccess: () => router.push("/checklists") },
    );
  }

  return (
    <div data-modal="true">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-gutter overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white border border-outline-variant p-lg sm:p-xl hard-shadow my-auto">
          <div className="text-center mb-sm">
            <button
              type="button"
              onClick={handleCancel}
              className="font-headline-md text-headline-md font-bold text-primary mb-lg block w-full"
            >
              Checklist Hub
            </button>
            <div className="flex flex-col items-center justify-center mb-sm">
              <Avatar
                src={user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture}
                alt={user?.user_metadata?.full_name || user?.email || "User"}
                className="h-10 w-10 rounded-full object-cover"
                iconClassName="text-primary text-[40px]"
              />
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {user?.email}
              </p>
            </div>
            <h1 className="font-headline-md text-headline-md text-on-surface">
              Complete your profile
            </h1>
          </div>

          <p className="font-body-sm text-body-sm text-on-surface-variant mb-sm text-center">
            Tell us about yourself to personalize your experience.
          </p>

          <form className="flex flex-col gap-lg" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1">
              <label className="form-label" htmlFor="designation">
                Designation
              </label>
              <div className="relative">
                <select
                  id="designation"
                  required
                  onInvalid={handleInvalid}
                  className="w-full bg-surface border border-outline px-4 py-2.5 text-base appearance-none focus:border-primary focus:outline-none"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                >
                  <option value="" disabled>
                    Select an option...
                  </option>
                  {DESIGNATIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant text-[20px]">
                  expand_more
                </span>
              </div>
              {designation === "other" && (
                <input
                  type="text"
                  required
                  onInvalid={handleInvalid}
                  placeholder="Enter your designation..."
                  className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none placeholder:text-surface-dim"
                  value={customDesignation}
                  onChange={(e) => setCustomDesignation(e.target.value)}
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label className="form-label" htmlFor="fullName">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                required
                onInvalid={handleInvalid}
                placeholder="Your full name"
                className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none placeholder:text-surface-dim"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="form-label" htmlFor="profession">
                Profession
              </label>
              <div className="relative">
                <select
                  id="profession"
                  required
                  onInvalid={handleInvalid}
                  className="w-full bg-surface border border-outline px-4 py-2.5 text-base appearance-none focus:border-primary focus:outline-none"
                  value={profession}
                  onChange={(e) => setProfession(e.target.value)}
                >
                  <option value="" disabled>
                    Select an option...
                  </option>
                  {PROFESSIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant text-[20px]">
                  expand_more
                </span>
              </div>
              {profession === "other" && (
                <input
                  type="text"
                  required
                  onInvalid={handleInvalid}
                  placeholder="Enter your profession..."
                  className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none placeholder:text-surface-dim"
                  value={customProfession}
                  onChange={(e) => setCustomProfession(e.target.value)}
                />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label className="form-label" htmlFor="institution">
                Institution
              </label>
              <input
                id="institution"
                type="text"
                required
                onInvalid={handleInvalid}
                placeholder="University, Museum, Organization..."
                className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none placeholder:text-surface-dim"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="form-label" htmlFor="location">
                Location
              </label>
              <div className="relative">
                <input
                  id="location"
                  type="text"
                  required
                  onInvalid={handleInvalid}
                  placeholder="Darjeeling, West Bengal, India"
                  className="w-full bg-surface border border-outline px-4 py-2.5 text-base focus:border-primary focus:outline-none placeholder:text-surface-dim"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onFocus={() => location.length >= 2 && setShowLocationSuggestions(true)}
                />
                {isLoadingLocations && (
                  <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px] animate-spin">
                    sync
                  </span>
                )}
                {showLocationSuggestions && locationSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-outline-variant shadow-md top-full">
                    {locationSuggestions.map((suggestion, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          skipNextLocationFetch.current = true;
                          setLocation(suggestion.display_name);
                          setLocationSuggestions([]);
                          setShowLocationSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-surface-container-low transition-colors border-b border-outline-variant last:border-0 text-sm"
                      >
                        <div className="font-code-md text-on-surface">{suggestion.name}</div>
                        <div className="text-xs text-on-surface-variant truncate">
                          {suggestion.display_name}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {updateProfile.isError && (
              <p className="text-base text-red-600">{(updateProfile.error as Error).message}</p>
            )}

            <button
              type="submit"
              disabled={updateProfile.isPending}
              className="w-full bg-primary-container text-on-primary py-3 font-headline-md text-base font-bold hard-shadow disabled:opacity-50 hover:translate-y-[-2px] transition-transform active:translate-y-[2px]"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
