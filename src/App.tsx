import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Unlock from "./pages/Unlock";
import UnlockRequired from "./pages/UnlockRequired";
import PremiumRequired from "./pages/PremiumRequired";
import PremiumBuyPage from "./pages/PremiumBuyPage";
import DailyTasksPage from "./pages/DailyTasksPage";
import { startVisitTracker, captureReferralFromUrl, checkReferralUpgrade } from "@/lib/dailyTasks";

import DynamicMeta from "./components/DynamicMeta";
import ManifestManager from "./components/ManifestManager";

import { installUiGuard } from "@/lib/uiGuard";
import AdBlockGateWatcher from "./components/AdBlockGateWatcher";
import BanGate from "./components/BanGate";
import AdBlockerDetected from "./pages/AdBlockerDetected";
import AdBlockerRemoved from "./pages/AdBlockerRemoved";
import { initAdShield } from "@/lib/adShield";
import ChromeBrowserGate from "./components/ChromeBrowserGate";
import { startPresence } from "@/lib/presence";

const RouteAttrSync = () => {
  const loc = useLocation();
  useEffect(() => startPresence(), []);
  useEffect(() => {
    try { document.documentElement.setAttribute("data-route", loc.pathname); } catch {}
  }, [loc.pathname]);
  return null;
};

// Install global anti-copy / anti-save / anti-devtools guard once.
installUiGuard();
// Warm the ad-shield relay base as early as possible.
initAdShield();
// Boot daily-task systems (visit-time tracker + referral capture).
startVisitTracker();
captureReferralFromUrl();
// Poll every 60s — as soon as visitor crosses 30 min today, referrer gets +9 coins.
if (typeof window !== "undefined") {
  setInterval(() => { void checkReferralUpgrade(); }, 60_000);
  setTimeout(() => { void checkReferralUpgrade(); }, 5_000);
}



const lazyWithReload = <T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) =>
  lazy<T>(() => factory().catch((err) => {
    const key = "rs_chunk_reload_ts";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
    throw err;
  }));

const Admin = lazyWithReload(() => import("@/pages/Admin"));
const AnExplorer = lazyWithReload(() => import("./pages/AnExplorer"));
const DownloadPage = lazyWithReload(() => import("./pages/DownloadPage"));
const queryClient = new QueryClient();

/** Standalone pages fade in softly (opacity only, so fixed layouts never shift). */
const Fade = ({ children }: { children: React.ReactNode }) => <div className="route-enter">{children}</div>;

const RouteFallback = () => (
  <div className="fixed inset-0 z-[200] bg-background/95 flex items-center justify-center">
    <div className="w-7 h-7 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
  </div>
);

const App = () => (
  <ChromeBrowserGate>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <DynamicMeta />
        <RouteAttrSync />
        <AdBlockGateWatcher />
        <BanGate />
        <ManifestManager />
        
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/download" element={<Suspense fallback={<RouteFallback />}><DownloadPage /></Suspense>} />
          <Route path="/admin" element={<Suspense fallback={<RouteFallback />}><Fade><Admin /></Fade></Suspense>} />
          <Route path="/admin/:section" element={<Suspense fallback={<RouteFallback />}><Fade><Admin /></Fade></Suspense>} />
          <Route path="/an-explorer" element={<Suspense fallback={<RouteFallback />}><Fade><AnExplorer /></Fade></Suspense>} />
          <Route path="/unlock" element={<Fade><Unlock /></Fade>} />
          <Route path="/unlock-required" element={<Fade><UnlockRequired /></Fade>} />
          <Route path="/premium-required" element={<Fade><PremiumRequired /></Fade>} />
          <Route path="/premium-buy" element={<Fade><PremiumBuyPage /></Fade>} />
          <Route path="/daily-tasks" element={<Fade><DailyTasksPage /></Fade>} />
          <Route path="/adblocker-detected" element={<Fade><AdBlockerDetected /></Fade>} />
          <Route path="/adblocker-removed" element={<Fade><AdBlockerRemoved /></Fade>} />
          

          {/* Main tab routes — all render Index, which syncs activePage from pathname */}
          <Route path="/" element={<Index />} />
          <Route path="/profile" element={<Index />} />
          <Route path="/series" element={<Index />} />
          <Route path="/movies" element={<Index />} />
          <Route path="/live-tv" element={<Index />} />
          <Route path="*" element={<Index />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ChromeBrowserGate>
);

export default App;
