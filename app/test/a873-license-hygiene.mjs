import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LICENSE_PATH = resolve(__dirname, '../..', 'LICENSE');

function runTest() {
  console.log('\n=== A-873: MIT License Hygiene Test ===\n');

  let licenseContent;
  try {
    licenseContent = readFileSync(LICENSE_PATH, 'utf8');
  } catch (err) {
    console.error(`❌ FAIL: LICENSE file not found at ${LICENSE_PATH}`);
    console.error(`Error: ${err.message}`);
    return false;
  }

  console.log('✓ LICENSE file exists');

  // Check for standard MIT license text
  const mitChecks = [
    { pattern: /MIT License/, name: 'MIT License header' },
    { pattern: /Copyright \(c\) 2026 Araso contributors/, name: 'Copyright notice with year 2026 and "Araso contributors"' },
    { pattern: /Permission is hereby granted/, name: 'Permission clause' },
    { pattern: /THE SOFTWARE IS PROVIDED "AS IS"/, name: 'AS-IS clause' },
    { pattern: /WITHOUT WARRANTY OF ANY KIND/, name: 'Warranty disclaimer' },
    { pattern: /INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY/, name: 'Full warranty disclaimer' },
  ];

  let allChecksPass = true;
  for (const check of mitChecks) {
    if (check.pattern.test(licenseContent)) {
      console.log(`✓ Contains: ${check.name}`);
    } else {
      console.error(`❌ FAIL: Missing: ${check.name}`);
      allChecksPass = false;
    }
  }

  // Check for private/sensitive paths
  const forbiddenPatterns = [
    { pattern: /_private/, name: '_private folder references' },
    { pattern: /\.env/, name: '.env file references' },
    { pattern: /\/Users\/[^/]+\//, name: 'local user paths' },
    { pattern: /\/home\/[^/]+\//, name: 'local home paths' },
    { pattern: /\/Users\//, name: 'absolute user paths' },
    { pattern: /\/private\/tmp/, name: 'private tmp paths' },
    { pattern: /password/i, name: 'password references' },
    { pattern: /secret/i, name: 'secret references' },
    { pattern: /key/i, name: 'crypto key references' },
    { pattern: /token/i, name: 'token references' },
  ];

  for (const check of forbiddenPatterns) {
    if (check.pattern.test(licenseContent)) {
      console.error(`❌ FAIL: Found forbidden content: ${check.name}`);
      allChecksPass = false;
    } else {
      console.log(`✓ No: ${check.name}`);
    }
  }

  // Check line count (standard MIT is roughly 20 lines)
  const lines = licenseContent.split('\n').filter(line => line.trim().length > 0);
  console.log(`✓ License contains ${lines.length} non-empty lines (expected ~20 for standard MIT)`);

  if (lines.length < 15 || lines.length > 25) {
    console.warn(`⚠ Warning: Line count seems unusual for standard MIT (expected 15-25)`);
  }

  console.log('\n' + (allChecksPass ? '✅ PASS: LICENSE hygiene check passed' : '❌ FAIL: License hygiene check failed'));
  console.log('');

  return allChecksPass;
}

export { runTest };

const result = runTest();
process.exit(result ? 0 : 1);
