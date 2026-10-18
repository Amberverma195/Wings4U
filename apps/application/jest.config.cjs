module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.cjs'],
  moduleNameMapper: {
    '^@wings4u/customization$': '<rootDir>/../../packages/customization/src/index.ts',
    '\\.(png|jpe?g)$': '<rootDir>/tests/image-asset.cjs',
    '^expo-constants$': '<rootDir>/tests/expo-constants-mock.cjs',
    '^expo-device$': '<rootDir>/tests/expo-device-mock.cjs',
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
