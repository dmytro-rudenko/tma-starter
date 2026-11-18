module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.acceptance.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  moduleNameMapper: {
    '^@dmytro-rudenko/tma-(nest-core|nest-bot|nest-payments|testing)$': '<rootDir>/../$1/src/index.ts',
  },
  testTimeout: 30000,
  maxWorkers: 4,
  workerIdleMemoryLimit: '1GB',
};
