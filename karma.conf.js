// Karma configuration file, see link for more information
// https://karma-runner.github.io/latest/config/configuration-file.html

// Chrome is discovered from CHROME_BIN or the system install. Both macOS dev
// machines and GitHub's ubuntu runners ship a Chrome that karma-chrome-launcher
// finds unaided, so we deliberately avoid a puppeteer devDependency (the
// versions that still support Node 14 are long unmaintained).

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage-istanbul-reporter'),
      require('@angular-devkit/build-angular/plugins/karma')
    ],
    client: {
      clearContext: false // leave Jasmine Spec Runner output visible in browser
    },
    coverageIstanbulReporter: {
      dir: require('path').join(__dirname, './coverage/wingsearch'),
      reports: ['html', 'lcovonly', 'text-summary'],
      fixWebpackSourcePaths: true
    },
    reporters: ['progress', 'kjhtml'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['ChromeHeadlessNoSandbox'],
    customLaunchers: {
      // CI runners have no sandbox and a small /dev/shm; the reducer specs also
      // pull in the full ~1.7 MB card JSON, so give the browser room to work.
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage'
        ]
      }
    },
    // Building both FlexSearch indexes over 747 birds + 61 bonus cards on module
    // load is slow enough to trip Karma's default 10s inactivity window.
    browserNoActivityTimeout: 120000,
    browserDisconnectTimeout: 60000,
    browserDisconnectTolerance: 2,
    captureTimeout: 120000,
    singleRun: false,
    restartOnFileChange: true
  })
}
