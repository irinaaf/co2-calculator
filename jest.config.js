/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    // Match the @/* path alias from tsconfig.json
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Override settings incompatible with ts-jest
          module: "commonjs",
          moduleResolution: "node",
        },
      },
    ],
  },
  // Collect coverage from lib/ and pages/api/
  collectCoverageFrom: [
    "lib/**/*.ts",
    "pages/api/**/*.ts",
    "!lib/export.ts",
  ],
  coverageReporters: ["text", "lcov", "json-summary"],
};

module.exports = config;
