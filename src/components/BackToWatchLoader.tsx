/** Full-screen return screen: spinner on top, "Back to watch page" and a moving bar. */
export default function BackToWatchLoader() {
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-5 bg-background px-8 text-foreground">
      <span className="h-12 w-12 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" aria-hidden />
      <p className="text-base font-bold">Back to watch page</p>
      <span className="back-watch-bar" aria-hidden><span /></span>
    </div>
  );
}
