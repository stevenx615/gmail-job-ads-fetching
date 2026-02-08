import { existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const envFile = resolve(root, '.env');
const envExample = resolve(root, '.env.example');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('\n--- Gmail Job Ads Fetcher - Setup ---\n');

  if (existsSync(envFile)) {
    const answer = await ask('.env already exists. Overwrite? (y/N): ');
    if (answer.toLowerCase() !== 'y') {
      console.log('Setup cancelled. Your existing .env was kept.\n');
      rl.close();
      return;
    }
  }

  if (!existsSync(envExample)) {
    console.error('.env.example not found. Make sure you cloned the full repo.\n');
    rl.close();
    process.exit(1);
  }

  copyFileSync(envExample, envFile);
  console.log('Created .env from .env.example\n');
  console.log('Next steps:');
  console.log('  1. Open .env in your editor');
  console.log('  2. Fill in your Firebase and Google OAuth credentials');
  console.log('  3. Run: npm run dev\n');
  console.log('See README.md for detailed setup instructions.\n');

  rl.close();
}

main();
