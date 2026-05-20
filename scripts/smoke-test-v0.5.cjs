/**
 * v0.5.0 smoke test — verifies that buildLaunchOptions emits the new
 * CloakBrowser 0.3.29 flags. Run with: node scripts/smoke-test-v0.5.cjs
 *
 * We compile the TS file on-the-fly via tsx-less hack: just rely on the
 * already-built CJS bundle in out/main/index.cjs is too coarse. Instead,
 * we use the .ts -> register pattern via ts-node would be heavy.
 *
 * Simplest: invoke the *raw* args building by reading the source and
 * pattern-checking. This catches missing flags without spinning electron.
 */
const fs = require('node:fs');
const path = require('node:path');

const fingerprintBuilderSrc = fs.readFileSync(
  path.join(__dirname, '..', 'electron/main/services/fingerprintBuilder.ts'),
  'utf-8',
);

const expected = [
  '--fingerprint-webrtc-ip=',
  '--enable-blink-features=FakeShadowRoot',
  '--disable-http2',
  '--fingerprint-noise=false',
  'humanPreset',
  'BuildLaunchExtras',
];

let ok = true;
for (const needle of expected) {
  if (fingerprintBuilderSrc.includes(needle)) {
    console.log('  ✓', needle);
  } else {
    console.log('  ✗ MISSING:', needle);
    ok = false;
  }
}

const browserLauncherSrc = fs.readFileSync(
  path.join(__dirname, '..', 'electron/main/services/browserLauncher.ts'),
  'utf-8',
);

const launcherExpected = [
  'getExpectedChromiumVersion',
  'readChromeProductVersion',
  'compareVersions',
  'humanPreset: profile.humanPreset',
  'disableHttp2: profile.disableHttp2',
  'fingerprintNoise: profile.fingerprintNoise',
];

console.log('\nbrowserLauncher.ts:');
for (const needle of launcherExpected) {
  if (browserLauncherSrc.includes(needle)) {
    console.log('  ✓', needle);
  } else {
    console.log('  ✗ MISSING:', needle);
    ok = false;
  }
}

const cbPkg = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'node_modules/cloakbrowser/package.json'),
  'utf-8',
));
console.log('\ncloakbrowser installed version:', cbPkg.version);

const expectedChromium = '146.';
// Read the config.js to extract expected version
const cfgSrc = fs.readFileSync(
  path.join(__dirname, '..', 'node_modules/cloakbrowser/dist/config.js'),
  'utf-8',
);
const winVer = cfgSrc.match(/"windows-x64":\s*"([^"]+)"/);
console.log('cloakbrowser expects Chromium:', winVer ? winVer[1] : 'unknown');

const cacheBinary = path.join(__dirname, '..', 'bin/cloakbrowser/chromium-' + (winVer ? winVer[1] : '?') + '/chrome.exe');
const resourceBinary = path.join(__dirname, '..', 'resources/cloakbrowser-windows-x64/chrome.exe');
console.log('cache binary exists:    ', fs.existsSync(cacheBinary), cacheBinary);
console.log('resource binary exists: ', fs.existsSync(resourceBinary), resourceBinary);

console.log('\n' + (ok ? '✅ SMOKE TEST PASSED' : '❌ SMOKE TEST FAILED'));
process.exit(ok ? 0 : 1);
