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

const RouteAttrSync = () => {
  const loc = useLocation();
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

const Admin = lazyWithReload(() => import("./pages/Admin"));
const AnExplorer = lazyWithReload(() => import("./pages/AnExplorer"));
const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="fixed inset-0 z-[200] bg-background/95 flex items-center justify-center">
    <div className="w-7 h-7 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DynamicMeta />
      <BrowserRouter>
        <RouteAttrSync />
        <AdBlockGateWatcher />
        <BanGate />
        <ManifestManager />
        
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/admin" element={<Suspense fallback={<RouteFallback />}><Admin /></Suspense>} />
          <Route path="/admin/:section" element={<Suspense fallback={<RouteFallback />}><Admin /></Suspense>} />
          <Route path="/an-explorer" element={<Suspense fallback={<RouteFallback />}><AnExplorer /></Suspense>} />
          <Route path="/unlock" element={<Unlock />} />
          <Route path="/unlock-required" element={<UnlockRequired />} />
          <Route path="/premium-required" element={<PremiumRequired />} />
          <Route path="/premium-buy" element={<PremiumBuyPage />} />
          <Route path="/daily-tasks" element={<DailyTasksPage />} />
          <Route path="/adblocker-detected" element={<AdBlockerDetected />} />
          <Route path="/adblocker-removed" element={<AdBlockerRemoved />} />
          

          {/* Main tab routes — all render Index, which syncs activePage from pathname */}
          <Route path="/" element={<Index />} />
          <Route path="/series" element={<Index />} />
          <Route path="/movies" element={<Index />} />
          <Route path="/live-tv" element={<Index />} />
          <Route path="*" element={<Index />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
