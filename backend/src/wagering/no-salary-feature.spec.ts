import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { FUND_SOURCE_TYPE, isWagerableSourceType } from './wagering-source';

/**
 * E18 — "No Salary code is added."
 *
 * SALARY exists ONLY as a non-wagerable *classification label* (it is a
 * documented non-wagerable source). No Salary management feature, service,
 * module, controller, DTO or ledger flow may exist. This statically scans the
 * backend source tree to guarantee that.
 */
const SRC_DIR = join(__dirname, '..');

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectTsFiles(full, acc);
    } else if (entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('No Salary feature is introduced (E18)', () => {
  const files = collectTsFiles(SRC_DIR);

  it('SALARY is never wagerable', () => {
    expect(isWagerableSourceType(FUND_SOURCE_TYPE.SALARY)).toBe(false);
  });

  it('contains no Salary service / module / controller / DTO', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('no-salary-feature.spec.ts')) continue;
      const content = readFileSync(file, 'utf8');
      if (
        /SalaryService|SalaryModule|SalaryController|SalaryDto|salary\.service|salary\.module|salary\.controller/.test(
          content,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no salary credit/withdrawal flow or salary endpoint', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('no-salary-feature.spec.ts')) continue;
      const content = readFileSync(file, 'utf8');
      if (
        /@Controller\(\s*['"]salary|'\/salary'|"\/salary"|creditSalary|deductSalary|distributeSalary/.test(
          content,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
