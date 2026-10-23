// Minimal FTP/FTPS client over node:net / node:tls (passive mode, binary, MLSD listings).
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

const clean = (s) => { if (/[\r\n]/.test(String(s))) throw new Error('invalid characters in FTP argument'); return String(s); };

export class FtpClient {
  /** secure: false | 'explicit' (AUTH TLS) | 'implicit'. Certificates are verified unless tlsOptions says otherwise. */
  constructor({ host, port = 21, user = 'anonymous', password = '', secure = false, timeoutMs = 10000, tlsOptions = {} }) {
    Object.assign(this, { host, port, user, password, secure, timeoutMs, tlsOptions });
    this.sock = null; this.buf = ''; this.replies = []; this.waiter = null; this.err = null;
  }

  _attach(sock) {
    this.sock = sock; sock.setEncoding('utf8'); sock.setTimeout(this.timeoutMs, () => sock.destroy(new Error('FTP control connection timed out')));
    sock.on('data', (d) => this._data(d));
    sock.on('error', (e) => this._fail(e));
    sock.on('close', () => this._fail(new Error('FTP connection closed')));
  }
  _fail(e) { this.err = this.err || e; if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(this.err); } }
  _data(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1);
      const m = /^(\d{3})([ -])/.exec(line);
      if (this.cur) { this.cur.lines.push(line); if (m && m[1] === this.cur.code && m[2] === ' ') this._done(); }
      else if (m) { this.cur = { code: m[1], lines: [line] }; if (m[2] === ' ') this._done(); }
    }
  }
  _done() {
    const r = { code: Number(this.cur.code), text: this.cur.lines.join('\n') }; this.cur = null;
    if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(r); } else this.replies.push(r);
  }
  reply() {
    if (this.replies.length) return Promise.resolve(this.replies.shift());
    if (this.err) return Promise.reject(this.err);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
  async cmd(line, ok) {
    this.sock.write(clean(line) + '\r\n');
    return this.expect(await this.reply(), ok, line.split(' ')[0]);
  }
  expect(r, ok, what) {
    if (ok && !ok.some((c) => Math.floor(r.code / (c < 10 ? 100 : 1)) === c)) throw new Error('FTP ' + what + ' failed: ' + r.text.split('\n')[0]);
    return r;
  }

  async connect() {
    const sock = await new Promise((resolve, reject) => {
      const s = (this.secure === 'implicit' ? tls.connect({ host: this.host, port: this.port, servername: this.host, ...this.tlsOptions }) : net.connect({ host: this.host, port: this.port }));
      s.once(this.secure === 'implicit' ? 'secureConnect' : 'connect', () => { s.removeListener('error', reject); resolve(s); });
      s.once('error', reject);
      s.setTimeout(this.timeoutMs, () => s.destroy(new Error('FTP connect timed out')));
    });
    this._attach(sock);
    this.expect(await this.reply(), [2], 'greeting');
    if (this.secure === 'explicit') {
      await this.cmd('AUTH TLS', [2]);
      sock.removeAllListeners('data'); sock.removeAllListeners('close'); sock.removeAllListeners('error');
      const t = tls.connect({ socket: sock, servername: this.host, ...this.tlsOptions });
      await new Promise((res, rej) => { t.once('secureConnect', res); t.once('error', rej); });
      this._attach(t);
    }
    const u = await this.cmd('USER ' + this.user, [2, 3]);
    if (u.code === 331) await this.cmd('PASS ' + this.password, [2]);
    await this.cmd('TYPE I', [2]);
    if (this.secure) { await this.cmd('PBSZ 0', [2]); await this.cmd('PROT P', [2]); }
    return this;
  }

  async _passive() {
    const r = await this.cmd('PASV', [2]);
    const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(r.text);
    if (!m) throw new Error('FTP bad PASV reply');
    const port = Number(m[5]) * 256 + Number(m[6]);
    // Connect to the control host, never the address in the reply (avoids FTP bounce/NAT problems).
    let d = await new Promise((resolve, reject) => { const s = net.connect({ host: this.host, port }, () => resolve(s)); s.once('error', reject); });
    if (this.secure) {
      d = tls.connect({ socket: d, servername: this.host, ...this.tlsOptions });
      await new Promise((res, rej) => { d.once('secureConnect', res); d.once('error', rej); });
    }
    d.setTimeout(this.timeoutMs, () => d.destroy(new Error('FTP data connection timed out')));
    return d;
  }

  async list(dir = '.') {
    const d = await this._passive();
    const chunks = [];
    d.on('data', (c) => chunks.push(c));
    const ended = new Promise((res, rej) => { d.once('end', res); d.once('close', res); d.once('error', rej); });
    try {
      await this.cmd('MLSD ' + dir, [1]);
      await ended;
      this.expect(await this.reply(), [2], 'MLSD');
    } finally { d.destroy(); }
    const out = [];
    for (const line of Buffer.concat(chunks).toString('utf8').split(/\r?\n/)) {
      const i = line.indexOf(' ');
      if (i < 0) continue;
      const facts = Object.fromEntries(line.slice(0, i).split(';').filter(Boolean).map((f) => { const k = f.indexOf('='); return [f.slice(0, k).toLowerCase(), f.slice(k + 1)]; }));
      if (facts.type === 'file') out.push({ name: line.slice(i + 1), size: Number(facts.size), modify: facts.modify || null });
    }
    return out;
  }

  /** Download to localPath (the caller picks a temp name); verifies the byte count when expectedSize is given. */
  async download(remote, localPath, expectedSize) {
    const d = await this._passive();
    try {
      await this.cmd('RETR ' + remote, [1]);
      await pipeline(d, fs.createWriteStream(localPath));
      this.expect(await this.reply(), [2], 'RETR');
    } catch (e) { d.destroy(); fs.rmSync(localPath, { force: true }); throw e; }
    const size = fs.statSync(localPath).size;
    if (expectedSize != null && size !== expectedSize) { fs.rmSync(localPath, { force: true }); throw new Error('partial transfer of ' + remote + ': got ' + size + ' of ' + expectedSize + ' bytes'); }
    return size;
  }

  async upload(localPath, remote) {
    const d = await this._passive();
    try {
      await this.cmd('STOR ' + remote, [1]);
      await pipeline(fs.createReadStream(localPath), d);
      this.expect(await this.reply(), [2], 'STOR');
    } catch (e) { d.destroy(); throw e; }
    return fs.statSync(localPath).size;
  }

  async rename(from, to) { await this.cmd('RNFR ' + from, [3]); await this.cmd('RNTO ' + to, [2]); }
  async remove(file) { await this.cmd('DELE ' + file, [2]); }

  async close() {
    if (!this.sock) return;
    try { this.sock.write('QUIT\r\n'); } catch { /* ignore */ }
    this.sock.destroy();
    this.sock = null;
  }
}
