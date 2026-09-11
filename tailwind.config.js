/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: '#0a0a0a',
          panel: '#111111',
          border: '#1a1a1a',
          green: '#00ff41',
          red: '#ff3131',
          dim: '#555555',
          text: '#e0e0e0',
        },
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'Monaco',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};