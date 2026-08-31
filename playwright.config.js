const { defineConfig } = require('@playwright/test');
const path = require('path');

const TEST_PORT = process.env.TEST_PORT || '3000';
const BASE_URL = process.env.BASE_URL || `http://localhost:${TEST_PORT}`;

module.exports = defineConfig({
  testDir: 'tests',

  testMatch: [
    'e2e/**/*.spec.js',
    'e2e/**/*.spec.ts',
    'playwright/**/*.spec.js',
    'playwright/**/*.spec.ts',
  ],

  timeout: 60000,
  retries: 0,

  reporter: [
    ['list'],
    ['html'],
    [
      'json',
      {
        outputFile: path.join(
          __dirname,
          'reports',
          'logs',
          'playwright-results.json'
        ),
      },
    ],
  ],

  use: {
    baseURL: BASE_URL,
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',

    launchOptions: {
      args: ['--disable-dev-shm-usage'],
    },
  },

  webServer: {
    command: `PORT=${TEST_PORT} node ${path.join(__dirname, 'server.js')}`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
