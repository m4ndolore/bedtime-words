'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:4173', ...devices['Pixel 7'] },
  webServer: { command: 'node tests/serve.js', url: 'http://127.0.0.1:4173/', reuseExistingServer: false },
});
