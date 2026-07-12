const { execFileSync } = require('node:child_process');

function fail(message) {
  throw new Error(message);
}

let staged = '';
try {
  staged = execFileSync('git', ['diff', '--name-only', '--cached'], { encoding: 'utf8' });
} catch (err) {
  fail('Could not inspect staged files before check: ' + String(err && err.message || err));
}

const stagedFiles = staged.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
if (stagedFiles.includes('data.json')) {
  fail('data.json is staged. Unstage it before committing so live business data is not overwritten.');
}

let dirtyLiveData = '';
try {
  dirtyLiveData = execFileSync('git', ['diff', '--name-only', '--', 'data.json'], { encoding: 'utf8' }).trim();
} catch (err) {
  fail('Could not inspect live data working-tree status: ' + String(err && err.message || err));
}

console.log('Live data protection check passed: data.json is not staged.' + (dirtyLiveData ? ' Local live-data edits are present and safely unstaged.' : ''));
