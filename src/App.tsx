import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Unlock from "./pages/Unlock";
import UnlockRequired from "./pages/UnlockRequired";
import DynamicMeta from "./components/DynamicMeta";
import ManifestManager from "./components/ManifestManager";


const Admin = lazy(() => import("./pages/Admin"));
const queryClient = new QueryClient();
const SPA_REDIRECT_KEY = "icf_spa_redirect";

const RouteFallback = () => (
  <div className="fixed inset-0 z-[200] bg-background/95 flex items-center justify-center">
    <div className="w-7 h-7 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
  </div>
);

const SpaRedirectRestore = () => {
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const redirectPath = sessionStorage.getItem(SPA_REDIRECT_KEY);
      sessionStorage.removeItem(SPA_REDIRECT_KEY);
      if (redirectPath?.startsWith("/") && !redirectPath.startsWith("//")) {
        navigate(redirectPath, { replace: true });
      }
    } catch {}
  }, [navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <DynamicMeta />
      <BrowserRouter>
        <SpaRedirectRestore />
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
