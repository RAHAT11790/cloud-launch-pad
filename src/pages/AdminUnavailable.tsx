import { ShieldOff } from "lucide-react";

/**
 * Android (user-panel) build stub. The admin panel lives on the website only —
 * no admin code is bundled into the app.
 */
const AdminUnavailable = () => (
  <div className="min-h-screen bg-background flex items-center justify-center px-6 text-center">
    <div className="space-y-3">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-muted/60 flex items-center justify-center">
        <ShieldOff className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="font-semibold">Not available in the app</p>
      <p className="text-xs text-muted-foreground max-w-[260px]">
        Management tools are available on the website.
      </p>
    </div>
  </div>
);

export default AdminUnavailable;
