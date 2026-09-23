module.exports = {
  extends: ['@cruzei/eslint-config/nestjs.js'],
  parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: __dirname },
  ignorePatterns: ['dist/', 'coverage/'],
};
