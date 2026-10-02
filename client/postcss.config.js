/** PostCSS pipeline: Tailwind first, then vendor prefixing for older Android. */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
