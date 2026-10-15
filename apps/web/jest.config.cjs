module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.cjs'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^react$': require.resolve('react'),
    '^react/jsx-runtime$': require.resolve('react/jsx-runtime'),
    // Reuse the React renderer already installed in this monorepo.
    '^react-test-renderer$': require.resolve('react-test-renderer', {
      paths: [__dirname, `${__dirname}/../application`],
    }),
  },
  transform: {
    '^.+\\.tsx?$': ['babel-jest', {
      configFile: false,
      babelrc: false,
      presets: [['next/babel', { 'preset-react': { runtime: 'automatic' } }]],
    }],
  },
};
