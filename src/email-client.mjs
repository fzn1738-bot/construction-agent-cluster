// Minimal IMAP4rev1 client over node:net / node:tls: LOGIN, SELECT, UID SEARCH, UID FETCH (headers).
import net from 'node:net';
import tls from 'node:tls';

const quote = (s) => { if (/[\r\n\0]/.test(String(s))) throw new Error('invalid characters in IMAP argument'); return '"' + String(s).replace(/(["\\])/g, '\\$1') + '"'; };

export class ImapClient {
  constructor({ host, port, user, password, secure = true, mailbox = 'INBOX', timeoutMs = 15000, tlsOptions = {} }) {
    Object.assign(this, { host, port: port || (secure ? 993 : 143), user, password, secure, mailbox, timeoutMs, tlsOptions });
    this.sock = null; this.buf = Buffer.alloc(0); this.cur = null; this.queue = []; this.waiter = null; this.err = null; this.tagN = 0; this.untagged = [];
  }

  async connect() {
    const sock = await new Promise((resolve, reject) => {
      const s = this.secure ? tls.connect({ host: this.host, port: this.port, servername: this.host, ...this.tlsOptions }) : net.connect({ host: this.host, port: this.port });
      s.once(this.secure ? 'secureConnect' : 'connect', () => { s.removeListener('error', reject); resolve(s); });
      s.once('error', reject);
      s.setTimeout(this.timeoutMs, () => s.destroy(new Error('IMAP connect timed out')));
    });
    this.sock = sock;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this._parse(); });
    sock.on('error', (e) => this._fail(e));
    sock.on('close', () => this._fail(new Error('IMAP connection closed')));
    sock.setTimeout(this.timeoutMs, () => sock.destroy(new Error('IMAP connection timed out')));
    const greet = await this._next();
    if (!/^\* (OK|PREAUTH)/i.test(greet.text)) throw new Error('IMAP unexpected greeting: ' + greet.text.slice(0, 80));
    await this.command('LOGIN ' + quote(this.user) + ' ' + quote(this.password));
    return this;
  }

  _fail(e) { this.err = this.err || e; if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(this.err); } }
  // Split the byte stream into responses; a line ending in {n} is followed by n literal bytes, then the rest of the line.
  _parse() {
    while (true) {
      if (!this.cur) this.cur = { text: '', literals: [] };
      const i = this.buf.indexOf('\r\n');
      if (i < 0) return;
      const line = this.buf.subarray(0, i).toString('utf8');
      const lit = /\{(\d+)\}$/.exec(line);
      if (lit) {
        const n = Number(lit[1]);
        if (this.buf.length < i + 2 + n) return;
        this.cur.text += line; this.cur.literals.push(this.buf.subarray(i + 2, i + 2 + n).toString('utf8'));
        this.buf = this.buf.subarray(i + 2 + n);
        continue;
      }
      this.cur.text += line; this.buf = this.buf.subarray(i + 2);
      const done = this.cur; this.cur = null;
      if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(done); } else this.queue.push(done);
    }
  }
  _next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.err) return Promise.reject(this.err);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  /** Send a tagged command; resolves with the untagged responses collected before the tagged status. */
  async command(text) {
    const tag = 'A' + String(++this.tagN).padStart(4, '0');
    this.sock.write(tag + ' ' + text + '\r\n');
    const untagged = [];
    while (true) {
      const r = await this._next();
      if (r.text.startsWith(tag + ' ')) {
        if (!/^\S+ OK/i.test(r.text)) throw new Error('IMAP ' + text.split(' ')[0] + ' failed: ' + r.text.slice(tag.length + 1, 120));
        return untagged;
      }
      untagged.push(r);
    }
  }

  async select(mailbox = this.mailbox) {
    const res = await this.command('SELECT ' + quote(mailbox));
    const find = (re) => { for (const r of res) { const m = re.exec(r.text); if (m) return Number(m[1]); } return null; };
    const uidValidity = find(/UIDVALIDITY (\d+)/i);
    if (uidValidity == null) throw new Error('IMAP server did not report UIDVALIDITY');
    return { uidValidity, exists: find(/^\* (\d+) EXISTS/i) ?? 0, uidNext: find(/UIDNEXT (\d+)/i) };
  }

  /** UIDs >= fromUid, ascending. (UID n:* always returns the last message, so filter.) */
  async uidsFrom(fromUid) {
    const res = await this.command('UID SEARCH UID ' + Number(fromUid) + ':*');
    const uids = [];
    for (const r of res) { const m = /^\* SEARCH ?(.*)$/i.exec(r.text); if (m) uids.push(...m[1].split(/\s+/).filter(Boolean).map(Number)); }
    return [...new Set(uids)].filter((u) => u >= fromUid).sort((a, b) => a - b);
  }

  /** Raw header block of one message, or null when the server returned nothing for it. */
  async fetchHeader(uid) {
    const res = await this.command('UID FETCH ' + Number(uid) + ' (UID BODY.PEEK[HEADER])');
    for (const r of res) if (/\bFETCH\b/i.test(r.text) && r.literals.length) return r.literals[0];
    return null;
  }

  async logout() {
    if (!this.sock) return;
    try { this.sock.write('Z0 LOGOUT\r\n'); } catch { /* ignore */ }
    this.sock.destroy(); this.sock = null;
  }
}

/** Parse a header block into { from, subject, date, messageId } (unfolds, decodes RFC 2047 words). */
export function parseHeader(raw) {
  const h = {};
  for (const line of String(raw || '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = decodeWords(line.slice(i + 1).trim()); }
  }
  return { from: h.from || '', subject: h.subject || '', date: h.date || '', messageId: h['message-id'] || '', valid: Boolean(h.from || h.subject) };
}

function decodeWords(s) {
  return s.replace(/=\?([\w-]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try {
      const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64')
        : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, x) => String.fromCharCode(parseInt(x, 16))), 'latin1');
      return new TextDecoder(cs.toLowerCase() === 'utf-8' ? 'utf-8' : cs).decode(buf);
    } catch { return txt; }
  });
}
