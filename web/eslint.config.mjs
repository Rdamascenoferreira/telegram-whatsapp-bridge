import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    ignores: ['.next/**', 'node_modules/**'],
    rules: {
      '@next/next/no-img-element': 'off'
    }
  }
];

export default config;
