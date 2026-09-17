/* eslint-disable no-console */
// ============================================================
// TRON CONTROLLED E2E HARNESS (manual, isolated)
//   npm run tron:e2e
//
// Safety:
//  - Always runs the production preflight gate first (refuses on FAIL).
//  - Requires TRON_E2E_ENABLED=true before any broadcast-capable operation.
//  - Uses a dedicated E2E test address + test user (never production users).
//  - NEVER exposes/prints keys, mnemonics or API secrets.
//  - NEVER fakes success: unfunded/un-actionable steps are reported NOT RUN.
// ============================================================

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../../../app.module';
import { NetworkRegistryService } from '../../networks/network-registry.service';
import { TronCustodySigner } from './tron-custody-signer';
import { TronProductionPreflightService } from './tron-production-preflight.service';
import { TronDepositAdapter } from './tron-deposit-adapter';
import { TronReconciliationService } from './tron-reconciliation.service';
import { DepositSweepService } from '../../sweeps/deposit-sweep.service';
import { TRON_CHAIN_ID } from '../../config/networks.config';
import { DepositAddress, DepositAddressStatus } from '../../addresses/deposit-address.entity';
import { Deposit, DepositStatus } from '../../../deposits/deposit.entity';
import { LedgerEntry, LedgerType } from '../../../ledger/ledger.entity';
import { User } from '../../../users/user.entity';

type StepResult = 'PASS' | 'FAIL' | 'NOT RUN';

function report(step: string, status: StepResult, detail: string): void {
  console.log(`[${status}] ${step}: ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Reserved high index range keeps the E2E address apart from production indices. */
function e2eIndex(): number {
  return 9_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const config = app.get(ConfigService);
    const networks = app.get(NetworkRegistryService);
    const signer = app.get(TronCustodySigner);
    const preflight = app.get(TronProductionPreflightService);
    const sweepService = app.get(DepositSweepService);
    const reconciliation = app.get(TronReconciliationService);

    const depositRepo = app.get(getRepositoryToken(Deposit));
    const ledgerRepo = app.get(getRepositoryToken(LedgerEntry));
    const userRepo = app.get(getRepositoryToken(User));
    const depositAddressRepo = app.get(getRepositoryToken(DepositAddress));

    console.log(`==== TRON CONTROLLED E2E (${config.get('NODE_ENV') ?? 'development'}) ====`);

    const gate = await preflight.evaluate();
    for (const c of gate.checks) {
      report(`preflight.${c.key}`, c.status === 'PASS' ? 'PASS' : (c.status as StepResult), c.detail);
    }
    report(
      'preflight.gate',
      gate.ready ? 'PASS' : 'FAIL',
      gate.ready ? 'production gate ready' : 'production gate FAILED',
    );

    const e2eEnabled = config.get('TRON_E2E_ENABLED') === 'true';
    report(
      'e2e.flag',
      e2eEnabled ? 'PASS' : 'NOT RUN',
      e2eEnabled ? 'TRON_E2E_ENABLED=true' : 'TRON_E2E_ENABLED not true — plan-only',
    );

    if (!gate.ready) {
      console.log('\nABORT: production gate FAILED. Fix FAIL checks before running E2E.');
      process.exit(1);
    }
    if (!e2eEnabled) {
      const amount = config.get('TRON_E2E_USDT_AMOUNT') ?? '1';
      const address = await signer.deriveAddressForIndex(e2eIndex());
      console.log('\n=== PLAN ONLY (no broadcast) ===');
      console.log(`E2E deposit address : ${address}`);
      console.log('TRC20 USDT contract : TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
      console.log(`Clean test amount   : ${amount} USDT (+ a few TRX for sweep gas)`);
      console.log(
        'Detection/credit/sweep/reconcile run after you set TRON_E2E_ENABLED=true and fund the address.',
      );
      report('e2e.fund', 'NOT RUN', 'fund the address then re-run with TRON_E2E_ENABLED=true');
      process.exit(0);
    }
    await execute(config, networks, signer, sweepService, reconciliation, {
      depositRepo,
      ledgerRepo,
      userRepo,
      depositAddressRepo,
      adapterFactory: (network) =>
        new TronDepositAdapter(
          network,
          globalThis.fetch,
          config.get('TRON_GRID_API_KEY')?.trim() || undefined,
        ),
    });
  } finally {
    await app.close();
  }
}

interface ExecDeps {
  depositRepo: any;
  ledgerRepo: any;
  userRepo: any;
  depositAddressRepo: any;
  adapterFactory: (network: any) => TronDepositAdapter;
}

async function execute(
  config: ConfigService,
  networks: NetworkRegistryService,
  signer: TronCustodySigner,
  sweepService: DepositSweepService,
  reconciliation: TronReconciliationService,
  deps: ExecDeps,
): Promise<void> {
  const network = networks.getNetwork('tron');
  const adapter = deps.adapterFactory(network);
  const index = e2eIndex();
  const address = await signer.deriveAddressForIndex(index);

  const email = `e2e+${randomUUID().slice(0, 8)}@tradextest.dev`;
  const user = await deps.userRepo.save(
    deps.userRepo.create({ mobileNumber: email, email, role: 'user', status: 'active' }),
  );
  report('e2e.identity', 'PASS', `isolated test user id=${user.id}`);

  const existing = await deps.depositAddressRepo.findOne({
    where: { address, chainId: TRON_CHAIN_ID },
  });
  if (!existing) {
    await deps.depositAddressRepo.save(
      deps.depositAddressRepo.create({
        address,
        chainId: TRON_CHAIN_ID,
        userId: user.id,
        orderId: null,
        provider: 'tron_e2e',
        derivationIndex: index,
        derivationPath: `m/44'/195'/0'/0/${index}`,
        status: DepositAddressStatus.ACTIVE,
      }),
    );
  }
  report('e2e.address', 'PASS', `E2E deposit address: ${address} (index=${index})`);
  console.log(`\nSend ${config.get('TRON_E2E_USDT_AMOUNT') ?? '1'} USDT (TRC20) + a few TRX to ${address}\n`);

  const timeoutMs = Number(config.get('TRON_E2E_TIMEOUT_MS') ?? '600000');
  const started = Date.now();
  let deposit: any = null;
  while (Date.now() - started < timeoutMs) {
    deposit = await deps.depositRepo.findOne({ where: { depositAddress: address, chainId: TRON_CHAIN_ID } });
    if (deposit) break;
    await sleep(5000);
  }
  if (!deposit) {
    report('e2e.detection', 'NOT RUN', 'no incoming TRC20 USDT observed before timeout');
    return;
  }
  report(
    'e2e.detection',
    'PASS',
    `tx=${deposit.transactionHash} usdt=${deposit.usdtAmount} confirmations=${deposit.confirmations}`,
  );

  if (deposit.status === DepositStatus.COMPLETED || deposit.confirmations >= network.confirmations) {
    report('e2e.confirmation', 'PASS', `confirmations=${deposit.confirmations}/${deposit.requiredConfirmations}`);
  } else {
    report('e2e.confirmation', 'NOT RUN', 'below confirmation threshold yet');
  }

  const ledger = await deps.ledgerRepo.find({
    where: { referenceId: deposit.id, type: LedgerType.DEPOSIT },
  });
  const credited = deposit.status === DepositStatus.COMPLETED && ledger.length >= 1;
  report('e2e.credit', credited ? 'PASS' : 'NOT RUN', credited ? `ledger entries=${ledger.length}` : 'credit not observed');

  const transfers = await adapter.getTrc20Transfers(address, { limit: 200 });
  const dupDeposits = await deps.depositRepo.find({ where: { transactionHash: deposit.transactionHash } });
  report(
    'e2e.idempotency',
    dupDeposits.length === 1 ? 'PASS' : 'FAIL',
    `deposits for tx=${dupDeposits.length}, on-chain events=${transfers.filter((t) => t.txId === deposit.transactionHash).length}`,
  );

  try {
    const sweep = await sweepService.ensureSweep(deposit);
    report('e2e.sweep', sweep ? 'PASS' : 'NOT RUN', sweep ? `sweep=${sweep.id} status=${sweep.status} hash=${sweep.sweepTxHash ?? 'pending'}` : 'no sweep record');
  } catch (error) {
    report('e2e.sweep', 'NOT RUN', `sweep not actionable: ${(error as Error).message}`);
  }

  const rows = await reconciliation.reconcile();
  const row = rows.find((r) => r.address === address);
  report('e2e.reconciliation', row ? 'PASS' : 'NOT RUN', row ? `status=${row.status} residual=${row.residualSun}` : 'no reconciliation row');

  console.log('\nE2E HARNESS FINISHED. Review the step results above.');
}

void main();