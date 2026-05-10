/**
 * Verification script to check if ALIS credentials are accessible
 * from system environment variables
 *
 * Run with: node server/verify-env-vars.js
 */

console.log('\n🔍 Checking environment variables...\n');

const requiredVars = {
  'ALIS_USERNAME': process.env.ALIS_USERNAME,
  'ALIS_PASSWORD': process.env.ALIS_PASSWORD,
};

const optionalVars = {
  'PORT': process.env.PORT,
  'NODE_ENV': process.env.NODE_ENV,
  'PLAYWRIGHT_HEADED': process.env.PLAYWRIGHT_HEADED,
  'HUBSPOT_PRIVATE_APP_TOKEN': process.env.HUBSPOT_PRIVATE_APP_TOKEN,
  'HUBSPOT_PORTAL_ID': process.env.HUBSPOT_PORTAL_ID,
};

// Check required variables
console.log('📋 REQUIRED VARIABLES:');
let allRequiredSet = true;
Object.entries(requiredVars).forEach(([key, value]) => {
  const isSet = value ? '✅' : '❌';
  const displayValue = value ? `***${value.slice(-4)}` : 'NOT SET';
  console.log(`  ${isSet} ${key}: ${displayValue}`);
  if (!value) allRequiredSet = false;
});

// Check optional variables
console.log('\n📋 OPTIONAL VARIABLES:');
Object.entries(optionalVars).forEach(([key, value]) => {
  const isSet = value ? '✅' : '⚠️';
  console.log(`  ${isSet} ${key}: ${value || 'not set'}`);
});

console.log('\n' + '='.repeat(50));
if (allRequiredSet) {
  console.log('✅ All required environment variables are accessible!');
  console.log('\nThe app can successfully access:');
  console.log('  • ALIS_USERNAME');
  console.log('  • ALIS_PASSWORD');
  process.exit(0);
} else {
  console.log('❌ Some required environment variables are missing!');
  console.log('\nMissing credentials need to be set as system environment variables:');
  console.log('  • ALIS_USERNAME');
  console.log('  • ALIS_PASSWORD');
  console.log('\nOn Windows, set them with: setx ALIS_USERNAME "your_username"');
  process.exit(1);
}
