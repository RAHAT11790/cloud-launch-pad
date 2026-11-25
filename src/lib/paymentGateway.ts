/**
 * Premium payment gateway config — one Firebase node `settings/paymentGateway`.
 * Methods (bKash, Nagad, Binance, custom), the admin-contact card and the
 * "what you get" list. Plans stay in `bkashSettings.plans` (shared by all methods).
 */
export type PaymentKind = "mobile" | "crypto" | "other";

export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentKind;
  logo: string;
  /** Wallet number, Binance Pay ID or wallet address. */
  number: string;
  /** Agent / Personal / Merchant for mobile wallets; network (BEP20…) for crypto. */
  accountType: string;
  qr: string;
  instructions: string;
  enabled: boolean;
  /** Brand color used for buttons/borders. */
  color: string;
  /** Label for the box where the user types the account they paid from. */
  senderLabel: string;
}

export interface AdminContact {
  enabled: boolean;
  title: string;
  logo: string;
  telegram: string;
  whatsapp: string;
}

export interface PaymentGatewayConfig {
  methods: PaymentMethod[];
  contact: AdminContact;
  /** Custom benefit lines; empty = the site's automatic list. */
  benefits: string[];
  /** ৳ per 1 USDT, used to show crypto prices. */
  usdtRate: number;
  /** How long a payment request waits for review, in hours. */
  reviewHours: number;
}

export const DEFAULT_LOGOS = {
  bkash: "/payment-logos/bkash.svg",
  nagad: "/payment-logos/nagad.webp",
  binance: "/payment-logos/binance.svg",
  contact: "/payment-logos/admin-contact.svg",
} as const;

export const DEFAULT_METHODS: PaymentMethod[] = [
  { id: "bkash", name: "bKash", kind: "mobile", logo: DEFAULT_LOGOS.bkash, number: "", accountType: "Agent", qr: "", instructions: "Send Money to the number below, then submit the Transaction ID.", enabled: true, color: "#E2136E", senderLabel: "Your bKash Number" },
  { id: "nagad", name: "Nagad", kind: "mobile", logo: DEFAULT_LOGOS.nagad, number: "", accountType: "Personal", qr: "", instructions: "Send Money to the number below, then submit the Transaction ID.", enabled: true, color: "#EC1C24", senderLabel: "Your Nagad Number" },
  { id: "binance", name: "Binance", kind: "crypto", logo: DEFAULT_LOGOS.binance, number: "", accountType: "BEP20 (USDT)", qr: "", instructions: "Send USDT to the address / Pay ID below, then submit the Transaction ID.", enabled: true, color: "#F0B90B", senderLabel: "Your Binance Pay ID or wallet" },
];

export const DEFAULT_GATEWAY: PaymentGatewayConfig = {
  methods: DEFAULT_METHODS,
  contact: { enabled: true, title: "Admin Contact", logo: DEFAULT_LOGOS.contact, telegram: "", whatsapp: "" },
  benefits: [],
  usdtRate: 125,
  reviewHours: 24,
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

/** Fills missing fields; keeps admin order; legacy bKash settings fill an empty bKash method. */
export function normalizeGateway(raw: any, legacyBkash?: any): PaymentGatewayConfig {
  const src = raw && typeof raw === "object" ? raw : {};
  const rawMethods: any[] = Array.isArray(src.methods) ? src.methods : src.methods && typeof src.methods === "object" ? Object.values(src.methods) : [];
  const base = rawMethods.length ? rawMethods : DEFAULT_METHODS;
  const methods: PaymentMethod[] = base
    .filter((m) => m && typeof m === "object" && str(m.id))
    .map((m) => {
      const def = DEFAULT_METHODS.find((d) => d.id === m.id);
      const kind: PaymentKind = m.kind === "crypto" || m.kind === "other" ? m.kind : m.kind === "mobile" ? "mobile" : def?.kind || "other";
      return {
        id: str(m.id),
        name: str(m.name, def?.name || "Payment"),
        kind,
        logo: str(m.logo) || def?.logo || "",
        number: str(m.number),
        accountType: str(m.accountType, def?.accountType || ""),
        qr: str(m.qr),
        instructions: str(m.instructions, def?.instructions || ""),
        enabled: m.enabled !== false,
        color: /^#[0-9a-f]{6}$/i.test(str(m.color)) ? m.color : def?.color || "#F5B83D",
        senderLabel: str(m.senderLabel) || def?.senderLabel || "Your account / number",
      };
    });
  const bk = methods.find((m) => m.id === "bkash");
  if (bk && legacyBkash && typeof legacyBkash === "object") {
    if (!bk.number) bk.number = str(legacyBkash.phoneNumber);
    if (!bk.qr) bk.qr = str(legacyBkash.qrCodeLink);
    if (!rawMethods.length) {
      if (legacyBkash.accountType) bk.accountType = str(legacyBkash.accountType, bk.accountType);
      if (legacyBkash.instructions) bk.instructions = str(legacyBkash.instructions, bk.instructions);
    }
  }
  const c = src.contact && typeof src.contact === "object" ? src.contact : {};
  return {
    methods,
    contact: {
      enabled: c.enabled !== false,
      title: str(c.title) || DEFAULT_GATEWAY.contact.title,
      logo: str(c.logo) || DEFAULT_LOGOS.contact,
      telegram: str(c.telegram),
      whatsapp: str(c.whatsapp),
    },
    benefits: (Array.isArray(src.benefits) ? src.benefits : []).map((b: unknown) => str(b).trim()).filter(Boolean),
    usdtRate: num(src.usdtRate, DEFAULT_GATEWAY.usdtRate, 1, 100000),
    reviewHours: num(src.reviewHours, DEFAULT_GATEWAY.reviewHours, 1, 720),
  };
}

/** Methods a buyer can actually use: switched on and with a number/address set. */
export const usableMethods = (cfg: PaymentGatewayConfig) => cfg.methods.filter((m) => m.enabled && m.number.trim());

/** Plan price shown for a method: Taka for wallets, USDT (2 decimals, rounded up) for crypto. */
export function priceFor(method: Pick<PaymentMethod, "kind">, priceTaka: number, usdtRate: number): string {
  if (method.kind === "crypto") {
    const usdt = Math.ceil((priceTaka / usdtRate) * 100) / 100;
    return `${usdt.toFixed(2)} USDT`;
  }
  return `৳${priceTaka}`;
}

/** Sender check: wallets need an 11-digit BD number, others any 4+ characters. */
export function senderLooksValid(method: Pick<PaymentMethod, "kind">, value: string): boolean {
  const v = value.trim();
  if (method.kind === "mobile") return /^01\d{9}$/.test(v);
  return v.length >= 4;
}

/** Turns a Telegram username/link and a WhatsApp number/link into openable links. */
export function contactLinks(c: Pick<AdminContact, "telegram" | "whatsapp">) {
  const tg = c.telegram.trim();
  const wa = c.whatsapp.trim();
  return {
    telegram: !tg ? "" : /^https?:\/\//i.test(tg) ? tg : `https://t.me/${tg.replace(/^@/, "").replace(/^t\.me\//i, "")}`,
    whatsapp: !wa ? "" : /^https?:\/\//i.test(wa) ? wa : `https://wa.me/${wa.replace(/[^\d]/g, "")}`,
  };
}

const CACHE_KEY = "rs_payment_gateway_v1";
export function readCachedGateway(): any {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}
export function writeCachedGateway(raw: any) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(raw ?? null)); } catch { /* full */ }
}
