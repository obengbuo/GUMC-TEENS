'use strict';
/* Local dev server: runs the real Lambda handler against an in-memory DynamoDB (dynalite).
   Usage: npm run dev   ->  http://localhost:3000 */
const http = require('http');
const dynalite = require('dynalite');
const { DynamoDBClient, CreateTableCommand } = require('@aws-sdk/client-dynamodb');

async function start(port) {
  const db = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise((resolve) => db.listen(0, resolve));
  const endpoint = 'http://127.0.0.1:' + db.address().port;
  process.env.DDB_ENDPOINT = endpoint;
  process.env.TABLE_NAME = 'local-games';
  const client = new DynamoDBClient({ endpoint, region: 'local', credentials: { accessKeyId: 'x', secretAccessKey: 'x' } });
  await client.send(new CreateTableCommand({
    TableName: 'local-games', BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }]
  }));

  const { handler } = require('./app/index.js');
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://localhost');
      const out = await handler({
        rawPath: url.pathname,
        requestContext: { http: { method: req.method } },
        body: Buffer.concat(chunks).toString('utf8'),
        isBase64Encoded: false
      });
      res.writeHead(out.statusCode, out.headers);
      res.end(out.isBase64Encoded ? Buffer.from(out.body, 'base64') : out.body);
    });
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return { server, db, client, url: 'http://localhost:' + server.address().port, close: () => { server.close(); db.close(); } };
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.env.PORT) || 3000).then((s) => console.log('Bible Name Scramble running at ' + s.url));
}
