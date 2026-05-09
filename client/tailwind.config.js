/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Mono"', 'monospace'],
        body:    ['"DM Sans"', 'sans-serif'],
      },
      colors: {
        ink:    '#0f1117',
        panel:  '#181c26',
        border: '#252a38',
        muted:  '#4a5068',
        accent: '#4ade80',   // green — success/active
        warn:   '#f59e0b',   // amber — running
        danger: '#f87171',   // red — failed
        blue:   '#60a5fa',
      },
    },
  },
  plugins: [],
};
