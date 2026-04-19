export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    },
    extend: {
      colors: {
        brand: {
          50: '#faf8f5',
          100: '#f5f0eb',
          200: '#ebe1d6',
          300: '#d9ccba',
          400: '#c4b39a',
          500: '#a89279',
          600: '#8a7560',
          700: '#6d5c4d',
          800: '#4a3f36',
          900: '#2c2520',
          950: '#1a1613',
        },
        neutral: {
          50: '#fafafa',
          100: '#f5f5f5',
          150: '#efefef',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a',
        },
      },
    },
  },
  plugins: [],
};
