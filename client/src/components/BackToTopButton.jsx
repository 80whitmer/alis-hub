import { useState, useEffect } from 'react';

/** Floating "back to top" button for pages that can get long on the scroll (charts, tables, drill-downs). Only shown once scrolled down a bit, so it's not just sitting over the header. */
export default function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 400);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-6 right-6 z-50 w-11 h-11 rounded-full bg-accent-500 text-white shadow-lg hover:bg-accent-600 transition-colors flex items-center justify-center text-lg"
      aria-label="Back to top"
      title="Back to top"
    >
      ↑
    </button>
  );
}
