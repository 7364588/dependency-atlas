import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const baseFiles = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }, null, 2),
  'package.json': JSON.stringify({ private: true, scripts: { postinstall: 'node -e "throw new Error(\'must not run\')"' } }),
  'src/app.ts': "import { checkout } from '@/controllers/checkout';\nimport { log } from '@/infra/logger';\nexport const run = () => { log('checkout'); return checkout(); };\n",
  'src/routes/api.ts': "import { checkout } from '../controllers/checkout';\nexport const postCheckout = () => checkout();\n",
  'src/controllers/checkout.ts': "import { readCart } from '../services/cart';\nimport { charge } from '../services/payments';\nimport type { Order } from '../models/order';\nexport const checkout = (): Order => charge(readCart());\n",
  'src/services/cart.ts': "import { price } from './pricing';\nimport { inventory } from './inventory';\nexport const readCart = () => ({ total: price(inventory.length), items: inventory });\n",
  'src/services/pricing.ts': "export const price = (count: number) => count * 25;\n",
  'src/services/inventory.ts': "export const inventory = ['notebook', 'pencil'];\n",
  'src/services/payments.ts': "import { log } from '../infra/logger';\nexport const charge = (cart: { total: number }) => { log('charge'); return { total: cart.total, status: 'paid' }; };\n",
  'src/infra/logger.ts': "export const log = (message: string) => console.info(message);\n",
  'src/models/order.ts': "export interface Order { total: number; status: string; }\n",
  'src/ui/Checkout.tsx': "import type { Order } from '../models/order';\nimport React from 'react';\nexport const Checkout = ({ order }: { order: Order }) => <p>{order.status}</p>;\n",
  'src/plugins.ts': "export const loadPlugin = (name: string) => import(name);\n",
};

export const headFiles = {
  ...baseFiles,
  'src/controllers/checkout.ts': "import { readCart } from '../services/cart';\nimport { fulfill } from '../services/fulfillment';\nimport type { Order } from '../models/order';\nexport const checkout = (): Order => fulfill(readCart());\n",
  'src/services/cart.ts': "import { price } from './pricing';\nimport { inventory } from './inventory';\nimport { applyCoupon } from './discounts';\nexport const readCart = () => ({ total: applyCoupon(price(inventory.length)), items: inventory });\n",
  'src/services/discounts.ts': "import { readCart } from './cart';\n// Deliberate circular import for the review demo.\nexport const applyCoupon = (total: number) => total * 0.9;\nexport const preview = () => readCart();\n",
  'src/services/fulfillment.ts': "import { log } from '../infra/logger';\nimport type { Order } from '../models/order';\nexport const fulfill = (cart: { total: number }): Order => { log('queue'); return { total: cart.total, status: 'queued', itemCount: 2 }; };\n",
  'src/models/order.ts': "export interface Order { total: number; status: string; itemCount: number; }\n",
};
delete headFiles['src/services/payments.ts'];

/** Build a synthetic two-commit repository. No fixture code is executed. */
export function createFixture(directory) {
  mkdirSync(directory, { recursive: true });
  const environment = { ...process.env, GIT_AUTHOR_NAME: 'Demo Fixture', GIT_AUTHOR_EMAIL: 'demo@example.invalid', GIT_COMMITTER_NAME: 'Demo Fixture', GIT_COMMITTER_EMAIL: 'demo@example.invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).toString().trim();
  git('init', '-b', 'main');
  function write(files) { for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), content); } }
  write(baseFiles); git('add', '.'); git('commit', '-m', 'Add synthetic checkout modules');
  const base = git('rev-parse', 'HEAD');
  for (const path of Object.keys(baseFiles)) if (!(path in headFiles)) unlinkSync(join(directory, path));
  write(headFiles); environment.GIT_AUTHOR_DATE = environment.GIT_COMMITTER_DATE = '2026-01-02T00:00:00Z';
  git('add', '-A'); git('commit', '-m', 'Refactor fulfillment and add synthetic cycle');
  return { base, head: git('rev-parse', 'HEAD'), git };
}
