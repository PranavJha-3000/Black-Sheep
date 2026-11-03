/** @type {import('tailwindcss').Config} */
// Colours live as CSS variables in src/index.css so SVG strokes and Tailwind classes share one palette.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: v('canvas'),
          chrome: v('chrome'),
          panel: v('panel'),
          raised: v('raised'),
          border: 'rgb(255 255 255 / 0.07)',
          strong: 'rgb(255 255 255 / 0.14)',
          green: v('green'),
          red: v('red'),
          warn: v('orange'),
          caution: v('yellow'),
          accent: v('blue'),
          violet: v('purple'),
          text: v('text'),
          soft: v('soft'),
          dim: v('dim'),
          faint: v('faint'),
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
