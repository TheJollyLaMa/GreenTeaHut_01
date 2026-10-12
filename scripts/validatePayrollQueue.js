const fs = require('node:fs');
const path = require('node:path');
const { validateData } = require('../web/payroll-core');

const ROOT = path.resolve(__dirname, '..');
function validatePayrollQueue() {
  const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
  const queue = read('payroll-queue.json');
  validateData(queue, read('contributor-accounts.json'), read('payroll-assets.json'));
  console.log(`Payroll queue validated (${queue.pending.length} pending, ${queue.settled.length} settled; Base USDC)`);
}

if (require.main === module) {
  try { validatePayrollQueue(); } catch (error) {
    console.error(`Payroll validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { validatePayrollQueue };
