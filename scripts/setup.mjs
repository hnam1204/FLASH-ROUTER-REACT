import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.env.FLASH_ROUTER_DATA ?? join(process.cwd(), '.data');
await mkdir(root, { recursive: true });
console.log(`Runtime data directory ready: ${root}`);
