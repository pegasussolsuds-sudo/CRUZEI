module.exports = {
  extends: ['./base.js'],
  parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: __dirname },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-floating-promises': 'off',
  },
};
