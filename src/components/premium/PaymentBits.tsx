import type { CSSProperties } from "react";
import { Wallet, Send, MessageCircle } from "lucide-react";
import { contactLinks, type AdminContact, type PaymentMethod } from "@/lib/paymentGateway";
import { PaymentLogo } from "./PaymentLogo";
import { Button } from "@/components/ui/button";

export function MethodTile({ method, active, index = 0, onClick }: { method: PaymentMethod; active?: boolean; index?: number; onClick: () => void }) {
  return (
    <Button variant="ghost" size="unstyled" type="button" onClick={onClick} data-pay-method={method.id} aria-pressed={!!active}
      className={`pg3d-method ${active ? "is-on" : ""}`}
      style={{ "--mc": method.color, animationDelay: `${index * 70}ms` } as CSSProperties}>
      <span className={`pg3d-tile ${method.logo ? "" : "is-dark"}`}>
        {method.logo ? <PaymentLogo src={method.logo} /> : <Wallet className="w-6 h-6 text-muted-foreground" />}
      </span>
      <span className="pg3d-chip truncate max-w-full">{method.name}</span>
    </Button>
  );
}

export function AdminContactCard({ contact }: { contact: AdminContact }) {
  const links = contactLinks(contact);
  if (!contact.enabled || (!links.telegram && !links.whatsapp)) return null;
  return (
    <div className="pg3d-contact" data-admin-contact>
      <PaymentLogo src={contact.logo} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-foreground">{contact.title}</p>
        <p className="text-[11px] text-muted-foreground">Other payment or need help? Message the admin.</p>
        <div className="mt-2 flex gap-2">
          {links.telegram && (
            <a href={links.telegram} target="_blank" rel="noopener noreferrer"
              className="pg3d-pay !w-auto !py-2 !px-3 text-[12px] inline-flex items-center gap-1.5" style={{ "--mc": "#229ED9" } as CSSProperties}>
              <Send className="w-3.5 h-3.5" /> Telegram
            </a>
          )}
          {links.whatsapp && (
            <a href={links.whatsapp} target="_blank" rel="noopener noreferrer"
              className="pg3d-pay !w-auto !py-2 !px-3 text-[12px] inline-flex items-center gap-1.5" style={{ "--mc": "#25D366" } as CSSProperties}>
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
