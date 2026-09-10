/** @type {import('tailwindcss').Config} */

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ALIS Brand Colors — per ALIS_BrandGuide_2025.pdf.
        // Primary: Onyx/White foundation, Slate/Smoke for the mid-scale —
        // every text-primary-900/bg-primary-600/etc. across the app renders
        // from this scale, so re-deriving it is what re-skins the whole UI.
        primary: {
          50:  '#f7f7f7',
          100: '#eeeeee',
          200: '#d9d9da',
          300: '#c4c4c5',
          400: '#909295',   // Smoke
          500: '#6d6e71',   // Slate — body/neutral text per the guide
          600: '#4a4a4c',
          700: '#2e2e30',
          800: '#1a1a1b',
          900: '#000000',   // Onyx
        },

        // Accent: warm ALIS palette (Marigold -> Flame), used for CTAs,
        // highlights, borders — per the guide, never a dominant background.
        accent: {
          50:  '#fff7e8',
          100: '#ffedc7',
          200: '#fdd98a',
          300: '#fbb219',   // Marigold
          400: '#f77c02',   // Tangerine
          500: '#f06022',   // Amber — main accent
          600: '#ec4303',   // Flame
          700: '#e22405',   // Scarlet
          800: '#b81d04',
          900: '#8f1603',
        },

        // Cool secondary accent (Glacier / Mint) — for places that want a
        // secondary accent distinct from the warm CTA color. Glacier is
        // darkened from the brand guide's original #56a5c9 (Aaron, Sep
        // 2026: "too pale" once it became the app-wide labelling/link
        // color) — same hue, same "for places that want cool distinct
        // from warm" family, just deep enough to clear WCAG AA body-text
        // contrast (5.7:1 vs the original's 2.8:1) instead of reading as
        // a light-blue wash.
        cool: {
          glacier: '#2c6e8b',
          mint:    '#7cc7a6',
        },

        // Status colors — success/warning/info stay conventional (no brand
        // green exists, and universal red/green/yellow status semantics are
        // worth more to usability than strict brand-color purism here).
        // error adopts Scarlet, since the guide explicitly calls it out as
        // "an accent/alert shade only" — a real, intentional brand fit.
        success: '#10b981',   // Green
        warning: '#f59e0b',   // Amber
        error: '#e22405',     // Scarlet
        info: '#3b82f6',      // Blue

        // Neutral Scale (grays) — Slate/Smoke-tinted rather than the
        // previous cool blue-grays, so borders/backgrounds read as part of
        // the same warm-neutral family as primary.
        neutral: {
          50: '#f9f9f9',
          100: '#f3f3f3',
          150: '#ececec',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a8a8aa',
          500: '#909295',   // Smoke
          600: '#6d6e71',   // Slate
          700: '#4a4a4c',
          800: '#2e2e30',
          850: '#1f1f20',
          900: '#000000',   // Onyx
          950: '#000000',
        },

        // Legacy color names (for backward compatibility)
        ink: '#000000',
        panel: '#f9f9f9',
        border: '#e5e5e5',
        muted: '#909295',
        // Full shade scale (not just the bare 500), restoring Tailwind's
        // default blue-50..blue-900 utilities — a flat `blue: '#3b82f6'`
        // string here previously shadowed the whole default scale (extend
        // merges per color name, and a plain string for an existing name
        // fully replaces it, shades included), breaking every blue-N class
        // in the app (confirmed live: .alert-info's `bg-blue-50` failed to
        // build, along with blue-* usages in JobDetail.jsx/
        // FormMarkupApproval.jsx/FormAnalyzer.jsx) — pre-existing, not
        // something introduced by this session's changes.
        blue: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa',
          500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a', 950: '#172554',
        },
      },

      fontSize: {
        // Clean, modern typography scale
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },

      fontFamily: {
        // Primary: Lexend Exa (real Google Font, loaded in index.html) for
        // headlines/headings/CTAs per the brand guide.
        sans: ['"Lexend Exa"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['"Lexend Exa"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        // Secondary: Gotham Rounded is a commercial license with no font
        // files in this project — listed first so real files (if ever
        // added) are picked up automatically, falling back to Poppins (a
        // similarly rounded, friendly geometric sans, free on Google
        // Fonts) in the meantime.
        secondary: ['"Gotham Rounded"', '"Poppins"', '-apple-system', 'sans-serif'],
        mono: ['"Fira Code"', '"Courier New"', 'monospace'],
      },

      spacing: {
        gutter: '1.5rem',
        section: '3rem',
      },

      borderRadius: {
        // Modern, professional rounded corners
        sm: '0.375rem',   // 6px
        base: '0.5rem',   // 8px
        md: '0.75rem',    // 12px
        lg: '1rem',       // 16px
        xl: '1.5rem',     // 24px
      },

      boxShadow: {
        // Subtle, professional shadows
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        base: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        md: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        lg: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        xl: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
      },

      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-subtle': 'pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
      },

      backgroundImage: {
        'gradient-subtle': 'linear-gradient(135deg, #f0f4fa 0%, #f9fafb 100%)',
      },
    },
  },

  plugins: [
    function ({ addBase, theme }) {
      addBase({
        // Typography Defaults
        'h1': {
          '@apply text-4xl font-bold tracking-tight text-primary-900': {},
        },
        'h2': {
          '@apply text-3xl font-bold tracking-tight text-primary-800': {},
        },
        'h3': {
          '@apply text-2xl font-semibold text-primary-700': {},
        },
        'h4': {
          '@apply text-xl font-semibold text-primary-700': {},
        },
        'h5': {
          '@apply text-lg font-semibold text-primary-600': {},
        },
        'h6': {
          '@apply text-base font-semibold text-primary-600': {},
        },

        'body': {
          '@apply bg-neutral-50 text-neutral-800': {},
        },
        'p': {
          '@apply text-base leading-relaxed text-neutral-700': {},
        },

        // Links — cool-glacier blue rather than the warm accent scale
        // (Sep 2026, Aaron: warm-accent labelling/links read as an error
        // message, "reverse that vibe") — the warm scale's own error color
        // is Scarlet (#e22405), nearly identical to accent-600 Flame
        // (#ec4303), so any text in that family reads as alarm regardless
        // of intent. Blue is the universal "this is a link" signal and
        // reads as neither warm-CTA nor danger.
        'a': {
          '@apply text-cool-glacier hover:underline transition-colors duration-200': {},
        },

        // Input Elements
        'input, textarea, select': {
          '@apply bg-white border border-neutral-300 rounded-base px-3 py-2 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all duration-200': {},
        },

        'input:disabled, textarea:disabled, select:disabled': {
          '@apply bg-neutral-100 text-neutral-400 cursor-not-allowed': {},
        },

        // Buttons (default styling)
        'button': {
          '@apply transition-all duration-200': {},
        },
      });
    },
  ],
};
