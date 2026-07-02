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

import DynamicMeta from "./components/DynamicMeta";
import ManifestManager from "./components/ManifestManager";

import { installUiGuard } from "@/lib/uiGuard";

const RouteAttrSync = () => {
  const loc = useLocation();
  useEffect(() => {
    try { document.documentElement.setAttribute("data-route", loc.pathname); } catch {}
  }, [loc.pathname]);
  return null;
};

// Install global anti-copy / anti-save / anti-devtools guard once.
installUiGuard();



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
        <ManifestManager />
        
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/admin" element={<Suspense fallback={<RouteFallback />}><Admin /></Suspense>} />
          <Route path="/an-explorer" element={<Suspense fallback={<RouteFallback />}><AnExplorer /></Suspense>} />
          <Route path="/unlock" element={<Unlock />} />
          <Route path="/unlock-required" element={<UnlockRequired />} />
          <Route path="/premium-required" element={<PremiumRequired />} />
          <Route path="/premium-buy" element={<PremiumBuyPage />} />
          

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
