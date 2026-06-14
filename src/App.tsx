import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Unlock from "./pages/Unlock";
import UnlockRequired from "./pages/UnlockRequired";
import DynamicMeta from "./components/DynamicMeta";
import ManifestManager from "./components/ManifestManager";



const Admin = lazy(() => import("./pages/Admin"));
const AnExplorer = lazy(() => import("./pages/AnExplorer"));
const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="fixed inset-0 z-[200] bg-background/95 flex items-center justify-center">
    <div className="w-7 h-7 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
  </div>
);

const RouteWarmup = () => {
  useEffect(() => {
    const warm = () => import("./pages/Admin");
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === "function") {
      idle(warm);
      return;
    }
    const t = window.setTimeout(warm, 150);
    return () => window.clearTimeout(t);
  }, []);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DynamicMeta />
      <BrowserRouter>
        <RouteWarmup />
        <ManifestManager />
        
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/admin" element={<Suspense fallback={<RouteFallback />}><Admin /></Suspense>} />
          <Route path="/unlock" element={<Unlock />} />
          <Route path="/unlock-required" element={<UnlockRequired />} />
          <Route path="*" element={<Index />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
