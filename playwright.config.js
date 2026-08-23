const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Electron 应用是单实例，且各测试独立 userData，串行执行最稳
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  reporter: [['list']]
});
