module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.cjs'],
  moduleNameMapper: {
    '^react$': require.resolve('react'),
    '^react/jsx-runtime$': require.resolve('react/jsx-runtime'),
  },
  transform: {
    '^.+\\.tsx?$': ['babel-jest', {
      configFile: false,
      babelrc: false,
      presets: ['babel-preset-expo'],
    }],
  },
};
