// Email unsubscribe page — opened from the footer link of emails sent from the site's own domain.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MailX, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type State = "checking" | "valid" | "used" | "invalid" | "working" | "done" | "error";

const UnsubscribePage = () => {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";
  const [state, setState] = useState<State>(token ? "checking" : "invalid");

  useEffect(() => {
    if (!token) return;
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    fetch(`${base}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, { headers: { apikey: key } })
      .then((r) => r.json().catch(() => ({})))
      .then((d: any) => {
        if (d?.valid === true) setState("valid");
        else if (d?.reason === "already_unsubscribed") setState("used");
        else setState("invalid");
      })
      .catch(() => setState("error"));
  }, [token]);

  const confirm = async () => {
    setState("working");
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    if (error) { setState("error"); return; }
    if ((data as any)?.success) setState("done");
    else if ((data as any)?.reason === "already_unsubscribed") setState("used");
    else setState("error");
  };

  const view: Record<State, { icon: JSX.Element; title: string; body: string }> = {
    checking: { icon: <Loader2 className="h-8 w-8 animate-spin text-primary" />, title: "Checking your link…", body: "One moment please." },
    valid: { icon: <MailX className="h-8 w-8 text-primary" />, title: "Unsubscribe from RS ANIME03 emails?", body: "You will stop getting emails from RS ANIME03 at this address." },
    working: { icon: <Loader2 className="h-8 w-8 animate-spin text-primary" />, title: "Unsubscribing…", body: "One moment please." },
    done: { icon: <CheckCircle2 className="h-8 w-8 text-primary" />, title: "You're unsubscribed", body: "RS ANIME03 will not send emails to this address any more." },
    used: { icon: <CheckCircle2 className="h-8 w-8 text-primary" />, title: "Already unsubscribed", body: "This address is already unsubscribed from RS ANIME03 emails." },
    invalid: { icon: <AlertTriangle className="h-8 w-8 text-destructive" />, title: "This link is not valid", body: "The unsubscribe link is broken or has expired." },
    error: { icon: <AlertTriangle className="h-8 w-8 text-destructive" />, title: "Something went wrong", body: "Please try again in a moment." },
  };
  const v = view[state];

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card/80 backdrop-blur-xl shadow-2xl p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60">{v.icon}</div>
        <h1 className="text-xl font-bold mb-2">{v.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">{v.body}</p>
        {state === "valid" && (
          <Button className="w-full mb-3" onClick={confirm}>Confirm Unsubscribe</Button>
        )}
        {state === "error" && token && (
          <Button className="w-full mb-3" onClick={confirm}>Try again</Button>
        )}
        <Button variant="ghost" className="w-full" onClick={() => nav("/", { replace: true })}>Back to RS ANIME03</Button>
      </div>
    </main>
  );
};

export default UnsubscribePage;
