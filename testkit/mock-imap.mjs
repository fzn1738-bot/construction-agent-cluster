// In-memory IMAP server for tests (plain text). messages: [{ uid, header }]
import net from 'node:net';

export async function startImap({ user = 'bob', pass = 'secret', uidValidity = 1000, messages = [] } = {}) {
  const state = { uidValidity, messages: [...messages] };
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.write('* OK mock imap ready\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); handle(line); }
    });
    function handle(line) {
      const m = /^(\S+) (\S+)(?: (.*))?$/.exec(line); if (!m) return;
      const [, tag, cmd, arg = ''] = m;
      switch (cmd.toUpperCase()) {
        case 'LOGIN': { const [u, p] = [...arg.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]); return sock.write(u === user && p === pass ? `${tag} OK LOGIN done\r\n` : `${tag} NO [AUTHENTICATIONFAILED] bad credentials\r\n`); }
        case 'SELECT': return sock.write(`* ${state.messages.length} EXISTS\r\n* OK [UIDVALIDITY ${state.uidValidity}] ok\r\n* OK [UIDNEXT ${Math.max(0, ...state.messages.map((x) => x.uid)) + 1}] ok\r\n${tag} OK [READ-WRITE] SELECT done\r\n`);
        case 'UID': {
          const sm = /^SEARCH UID (\d+):\*$/i.exec(arg);
          if (sm) {
            const from = Number(sm[1]); const all = state.messages.map((x) => x.uid);
            const hit = all.filter((u) => u >= from); const res = hit.length ? hit : all.slice(-1);
            return sock.write(`* SEARCH ${res.join(' ')}\r\n${tag} OK SEARCH done\r\n`);
          }
          const fm = /^FETCH (\d+) /i.exec(arg);
          if (fm) {
            const msg = state.messages.find((x) => x.uid === Number(fm[1]));
            if (!msg || msg.header == null) return sock.write(`${tag} OK FETCH done\r\n`);
            const h = Buffer.from(msg.header);
            return sock.write(Buffer.concat([Buffer.from(`* 1 FETCH (UID ${msg.uid} BODY[HEADER] {${h.length}}\r\n`), h, Buffer.from(`)\r\n${tag} OK FETCH done\r\n`)]));
          }
          return sock.write(`${tag} BAD unknown\r\n`);
        }
        case 'LOGOUT': return sock.end(`* BYE\r\n${tag} OK bye\r\n`);
        default: return sock.write(`${tag} BAD unknown\r\n`);
      }
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, state, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}
