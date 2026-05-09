/** @type {import('tailwindcss').Config} */

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ALIS Brand Colors — Professional, Modern, Inviting
        // Primary: Navy (trust, professionalism)
        primary: {
          50: '#f0f4fa',
          100: '#d9e5f5',
          200: '#b3cbeb',
          300: '#7da8d8',
          400: '#4a85c5',
          500: '#2c5aa0',   // Main primary
          600: '#1a3a52',   // Dark primary (headers)
          700: '#152d3f',
          800: '#0f1e2e',
          900: '#0a1420',
        },

        // Accent: Teal (modern, inviting, action)
        accent: {
          50: '#f0fffe',
          100: '#ccf7f5',
          200: '#99efeb',
          300: '#26d0ce',
          400: '#00a896',   // Main accent
          500: '#008878',
          600: '#006b5f',
          700: '#005347',
          800: '#003d33',
          900: '#002b24',
        },

        // Status Colors
        success: '#10b981',   // Green
        warning: '#f59e0b',   // Amber
        error: '#ef4444',     // Red
        info: '#3b82f6',      // Blue

        // Neutral Scale (grays)
        neutral: {
          50: '#f9fafb',
          100: '#f3f4f6',
          150: '#eeeff2',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          850: '#1a202d',
          900: '#111827',
          950: '#030712',
        },

        // Legacy color names (for backward compatibility)
        ink: '#111827',
        panel: '#f9fafb',
        border: '#e5e7eb',
        muted: '#9ca3af',
        blue: '#3b82f6',
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
        // Modern system fonts with good readability
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        display: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
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

        // Links
        'a': {
          '@apply text-accent-500 hover:text-accent-600 transition-colors duration-200': {},
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
