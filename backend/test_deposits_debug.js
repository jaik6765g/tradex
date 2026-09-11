const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const http = require('http');

function getToken(userId, walletAddress) {
  const payload = { sub: userId, walletAddress, walletId: 'dummy', chainId: 56 };
  return jwt.sign(payload, 'tradex-dev-secret-change-this-2026', { expiresIn: '7d' });
}

function callEndpoint(port, token, path) {
  return new Promise((resolve) => {
    const url = 'http://localhost:' + port + path;
    const options = { headers: { Authorization: 'Bearer ' + token } };
    http.get(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: data.substring(0, 800) }));
    }).on('error', e => resolve({ status: 'ERR', data: e.message }));
  });
}

async function main() {
  const client = new Client({ host: 'localhost', port: 5432, user: 'tradex_admin', password: '', database: 'tradex' });
  await client.connect();

  const users = await client.query('SELECT u.id, u."walletAddress" FROM users u ORDER BY u."walletAddress"');
  console.log('Total users:', users.rows.length);
  let failures = 0;
  for (const u of users.rows) {
    const token = getToken(u.id, u.walletAddress);
    // Test new build (port 3001) which has getUserDepositsPaginated
    const dep = await callEndpoint(3001, token, '/deposits/me?limit=20&offset=0');
    const wd = await callEndpoint(3001, token, '/withdrawals/my?limit=20&offset=0');
    if (dep.status !== 200 || wd.status !== 200) {
      failures++;
      console.log('FAIL USER:', u.id, '| deposit:', dep.status, '| withdraw:', wd.status);
      if (dep.status !== 200) console.log('  DEP-RESP:', dep.data);
      if (wd.status !== 200) console.log('  WD-RESP:', wd.data);
    }
  }
  console.log('Total failures:', failures, 'of', users.rows.length, 'users');
  client.end();
}
main();
