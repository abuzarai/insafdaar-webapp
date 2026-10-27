// Serve the pinned SDK's media helpers locally: no CDN download during Start.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const version = '0.90.0';
const hashes = {
  'call-machine-object-bundle.js': 'dc89a7649f40e473e3fd03886e1bd11f3668c890fbcf46bcb518b13c75680bda',
  'audio-processor-bundle.js': 'a0b6d2ad8b73b2daf6530e4e1ca8e82f720fa5c2f2c13a7b5209010575e45a21',
};
const digest = data => createHash('sha256').update(data).digest('hex');
async function main() {
  const root = path.resolve(__dirname, '..');
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (lock.packages['node_modules/@daily-co/daily-js'].version !== version) throw new Error('Update pinned Daily helper hashes for this SDK version');
  const directory = path.join(root, 'public', 'vendor', 'daily', version);
  await fs.mkdir(directory, { recursive: true });
  for (const [name, expected] of Object.entries(hashes)) {
    const target = path.join(directory, name);
    const cached = await fs.readFile(target).catch(() => null);
    if (cached && digest(cached) === expected) continue;
    const response = await fetch(`https://c.daily.co/call-machine/versioned/${version}/static/${name}`, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error('Daily helper download failed');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) throw new Error('Daily helper exceeds size bound');
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    if (digest(data) !== expected) throw new Error('Daily helper integrity mismatch');
    await fs.writeFile(target, data);
  }
}
main().catch(() => { console.error('Pinned Daily media helpers could not be prepared; build/start stopped.'); process.exitCode = 1; });
