import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.env.FLASH_ROUTER_DATA_DIR
  ?? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'FLASH ROUTER') : join(process.cwd(), '.flash-router-data'));
await mkdir(root, { recursive: true });
console.log(`Runtime data directory ready: ${root}`);
