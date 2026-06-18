// ============================================================
// uiGuard — Global anti-copy / anti-save / anti-devtools friction
// ============================================================
// Notes:
//  - These are friction layers, NOT real DRM. A determined attacker
//    with DevTools/curl can still reach data. They block casual theft.
//  - We do NOT disable pointer-events on images globally (that would
//    break tap-to-open cards). We disable drag + native long-press menu.
//  - We allow text-selection inside inputs/textareas/contenteditable so
//    the admin panel keeps working normally.

let installed = false;

const isEditable = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((node as HTMLElement).isContentEditable) return true;
  // walk up a few parents
  let p: HTMLElement | null = node.parentElement;
  let hops = 0;
  while (p && hops++ < 4) {
    if (p.isContentEditable) return true;
    p = p.parentElement;
  }
  return false;
};

const isAdminRoute = () =>
  typeof window !== "undefined" && window.location.pathname.startsWith("/admin");

export const installUiGuard = () => {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // 1) Right-click / long-press context menu — disabled site-wide
  //    (admin still works; the menu was never needed for admin UX)
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (isEditable(e.target)) return; // allow paste menu in inputs
      e.preventDefault();
    },
    { capture: true }
  );

  // 2) Prevent image dragging (drag-to-save / drag-to-other-tab)
  window.addEventListener(
    "dragstart",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "IMG" || t.tagName === "VIDEO")) e.preventDefault();
    },
    { capture: true }
  );

  // 3) Block copy/cut on non-editable areas
  const blockClipboard = (e: ClipboardEvent) => {
    if (isEditable(e.target)) return;
    if (isAdminRoute()) return; // admin can copy IDs etc.
    e.preventDefault();
  };
  window.addEventListener("copy", blockClipboard, { capture: true });
  window.addEventListener("cut", blockClipboard, { capture: true });

  // 4) DevTools / view-source / save-page keyboard shortcuts
  window.addEventListener(
    "keydown",
    (e) => {
      if (isAdminRoute()) return; // admins use devtools legitimately
      const k = e.key?.toLowerCase();
      // F12
      if (e.key === "F12") {
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + Shift + I / J / C  (devtools)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === "i" || k === "j" || k === "c")) {
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + U (view source) / Ctrl+S (save) / Ctrl+P (print)
      if ((e.ctrlKey || e.metaKey) && (k === "u" || k === "s" || k === "p")) {
        if (isEditable(e.target)) return;
        e.preventDefault();
      }
    },
    { capture: true }
  );
};
