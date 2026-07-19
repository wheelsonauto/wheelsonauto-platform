'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { repairDataIds } = require('../server.js');
const { userArguments } = require('./cli-arguments');

function checksum(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function writeExclusive(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(temporary, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function main() {
  const [sourceArgument, outputArgument] = userArguments();
  if (!sourceArgument || !outputArgument) {
    throw new Error('Usage: pnpm run repair-data -- <source.json> <new-protected-copy.json>. The command never rewrites its source.');
  }
  const source = path.resolve(process.cwd(), sourceArgument);
  const output = path.resolve(process.cwd(), outputArgument);
  if (source === output) throw new Error('Repair output must be a separate new file. The source is never rewritten.');

  const sourceBytes = await fs.readFile(source);
  const sourceChecksum = checksum(sourceBytes);
  const data = JSON.parse(sourceBytes.toString('utf8'));
  repairDataIds(data);
  const outputBytes = Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8');
  const outputChecksum = checksum(outputBytes);

  const sourceAfterRepair = await fs.readFile(source);
  if (checksum(sourceAfterRepair) !== sourceChecksum) {
    throw new Error('Source data changed while the protected repair copy was being prepared. No output was written; retry from a fresh source review.');
  }
  await writeExclusive(output, outputBytes);
  const sourceAfterWrite = await fs.readFile(source);
  if (checksum(sourceAfterWrite) !== sourceChecksum) {
    await fs.rm(output, { force: true });
    throw new Error('Source data changed while the protected repair copy was being written. The incomplete output was removed.');
  }
  const savedBytes = await fs.readFile(output);
  if (checksum(savedBytes) !== outputChecksum) {
    await fs.rm(output, { force: true });
    throw new Error('Protected repair copy checksum verification failed. The incomplete output was removed.');
  }
  const mode = (await fs.stat(output)).mode & 0o777;
  if (mode !== 0o600) {
    await fs.rm(output, { force: true });
    throw new Error('Protected repair copy permissions are not mode 0600. The unsafe output was removed.');
  }

  console.log(JSON.stringify({
    ok: true,
    changed: outputChecksum !== sourceChecksum,
    source,
    output,
    sourceChecksum,
    outputChecksum,
    outputMode: '0600',
    message: 'A separate checksummed repair copy was created. The source was not changed. Run consistency checks against the copy before using it for any controlled migration.'
  }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
