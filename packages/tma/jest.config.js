module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [
    '<rootDir>/src/{nest-core,nest-bot,nest-payments,testing}/**/*.spec.ts',
    '<rootDir>/test/{nest-core,nest-bot,nest-payments,testing}/**/*.acceptance.spec.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  moduleNameMapper: {
    '^@pctea/tma/package\\.json$': '<rootDir>/package.json',
    '^@pctea/tma/(nest-core|nest-bot|nest-payments|testing)$': '<rootDir>/src/$1/index.ts',
  },
  testTimeout: 30000,
  maxWorkers: 4,
  workerIdleMemoryLimit: '1GB',
};
