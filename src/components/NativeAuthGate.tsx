import { useEffect, useState } from "react";

import LoginPage from "@/components/LoginPage";
import { isNativeApp } from "@/lib/nativeRuntime";
import { supabase } from "@/integrations/supabase/client";

const readLocalUser = () => {
  try {
    const raw = JSON.parse(localStorage.getItem("rsanime_user") || "null");
    // Guest records are never a valid session inside the Android app.
    if (raw?.id && !raw?.isGuest && raw?.email) return raw;
  } catch {}
  return null;
};

/**
 * Android app entry gate: the app always opens on the login screen and nothing
 * else is reachable until a real account signs in. Guest mode does not exist in
 * the native build.
 */
const NativeAuthGate = ({ children }: { children: React.ReactNode }) => {
  const native = isNativeApp();
  const [ready, setReady] = useState(!native);
  const [authed, setAuthed] = useState(() => (native ? Boolean(readLocalUser()) : true));

  useEffect(() => {
    if (!native) return;
    let alive = true;

    // Clear any guest leftovers so the login screen is always first.
    try {
      const raw = JSON.parse(localStorage.getItem("rsanime_user") || "null");
      if (raw?.isGuest) localStorage.removeItem("rsanime_user");
    } catch {}

    const sync = async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setAuthed(Boolean(data.session?.user) || Boolean(readLocalUser()));
      setReady(true);
    };
    void sync();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setAuthed(Boolean(session?.user) || Boolean(readLocalUser()));
    });

    const onStorage = () => setAuthed(Boolean(readLocalUser()));
    window.addEventListener("storage", onStorage);

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [native]);

  if (!native) return <>{children}</>;

  if (!ready) {
    return (
      <div className="fixed inset-0 z-[300] bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return <>{children}</>;
};

export default NativeAuthGate;
