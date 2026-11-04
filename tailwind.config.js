/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0f172a',
          800: '#1e293b',
          900: '#0f172a'
        }
      },
      minHeight: { tap: '48px' },
      height: { tap: '48px' }
    }
  },
  plugins: []
};
