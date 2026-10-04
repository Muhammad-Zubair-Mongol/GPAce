import { execFileSync } from 'node:child_process';

const project = 'mzm-gpace';
const command = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function gcloud(args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: process.platform === 'win32'
  });
}

function discoverBucket() {
  if (process.env.GPACE_UPLOAD_BUCKET) return process.env.GPACE_UPLOAD_BUCKET;
  const buckets = JSON.parse(gcloud(['storage', 'buckets', 'list', '--project', project, '--format=json']));
  const names = buckets.map(bucket => String(bucket.name || bucket.id || '')
    .replace(/^gs:\/\//, '').replace(/\/$/, ''));
  return [`${project}.firebasestorage.app`, `${project}.appspot.com`]
    .find(name => names.includes(name));
}

const bucket = discoverBucket();
if (!bucket) {
  throw new Error(`No Firebase Storage bucket found for ${project}. Create one or set GPACE_UPLOAD_BUCKET.`);
}

console.log(`Deploying gpace-api with durable uploads in ${bucket}`);
const deployment = gcloud([
  'run', 'deploy', 'gpace-api', '--source', '.', '--region', 'us-central1',
  '--project', project, '--allow-unauthenticated', '--quiet',
  '--memory', '1Gi', '--set-env-vars', `GPACE_UPLOAD_BUCKET=${bucket}`
]);
process.stdout.write(deployment);
