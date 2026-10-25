// In-memory FTP server for tests (plain, passive mode only).
import net from 'node:net';

export async function startFtp({ user = 'bob', pass = 'secret', files = {}, truncateRetr = false } = {}) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k, { data: Buffer.from(v), modify: '20260101120000' }]));
  const log = [];
  const server = net.createServer((sock) => {
    let pasv = null, dataSock = null, rnfr = null, authed = false, gotUser = null;
    const reply = (s) => sock.write(s + '\r\n');
    const withData = (fn) => { const go = (d) => fn(d); if (dataSock) go(dataSock); else pasv.once('data', go); };
    reply('220 mock ftp');
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); handle(line); }
    });
    sock.on('error', () => {});
    function handle(line) {
      const [cmd, ...rest] = line.split(' '); const arg = rest.join(' '); log.push(line);
      switch (cmd.toUpperCase()) {
        case 'USER': gotUser = arg; return reply('331 password please');
        case 'PASS': authed = gotUser === user && arg === pass; return reply(authed ? '230 ok' : '530 login incorrect');
        case 'TYPE': return reply('200 binary');
        case 'PASV': {
          dataSock = null;
          pasv = net.createServer((ds) => { dataSock = ds; ds.on('error', () => {}); pasv.emit('data', ds); });
          pasv.listen(0, '127.0.0.1', () => { const p = pasv.address().port; reply(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255})`); });
          return;
        }
        case 'MLSD': {
          if (!authed) return reply('530 not logged in');
          reply('150 listing');
          return withData((ds) => {
            const dir = arg.replace(/\/$/, '');
            const out = [...store].filter(([k]) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/')).map(([k, v]) => `type=file;size=${v.data.length};modify=${v.modify}; ${k.slice(dir.length + 1)}`).join('\r\n');
            ds.end(out + '\r\n'); pasv.close(); reply('226 done');
          });
        }
        case 'RETR': {
          const f = store.get(arg); if (!f) return reply('550 no such file');
          reply('150 sending');
          return withData((ds) => { ds.end(truncateRetr ? f.data.subarray(0, Math.floor(f.data.length / 2)) : f.data); pasv.close(); reply('226 done'); });
        }
        case 'STOR': {
          reply('150 receiving');
          return withData((ds) => { const chunks = []; ds.on('data', (c) => chunks.push(c)); ds.on('end', () => { store.set(arg, { data: Buffer.concat(chunks), modify: '20260102120000' }); pasv.close(); reply('226 stored'); }); });
        }
        case 'RNFR': rnfr = arg; return reply(store.has(arg) ? '350 ready' : '550 no such file');
        case 'RNTO': { store.set(arg, store.get(rnfr)); store.delete(rnfr); return reply('250 renamed'); }
        case 'QUIT': reply('221 bye'); return sock.end();
        default: return reply('502 Command not supported by this test server');
      }
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, files: store, log, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}
