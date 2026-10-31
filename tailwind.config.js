/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#07080a',
        surface: {
          DEFAULT: '#0d0d0d',
          elevated: '#101111',
          card: '#121212',
          button: '#18191a',
        },
        hairline: {
          DEFAULT: '#242728',
          soft: 'rgba(255, 255, 255, 0.08)',
          strong: 'rgba(255, 255, 255, 0.16)',
        },
        ink: {
          DEFAULT: '#f4f4f6',
          bright: '#ffffff',
          body: '#cdcdcd',
          charcoal: '#d3d3d4',
          mute: '#9c9c9d',
          ash: '#6a6b6c',
          stone: '#434345',
        },
        status: {
          green: '#59d499',
          'green-soft': 'rgba(89, 212, 153, 0.15)',
          yellow: '#ffc533',
          'yellow-soft': 'rgba(255, 197, 51, 0.15)',
          red: '#ff6161',
          'red-soft': 'rgba(255, 97, 97, 0.15)',
          blue: '#57c1ff',
          'blue-soft': 'rgba(87, 193, 255, 0.15)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '16px',
      },
    },
  },
  plugins: [],
};
