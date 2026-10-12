import { useEffect } from "react";

// Calls onEscape when Escape is pressed while `active` is true — for
// modals and pop-ups, so keyboard users can close them without a mouse.
export function useEscapeKey(onEscape, active = true) {
  useEffect(() => {
    if (!active || !onEscape) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, active]);
}
