// utils/optionsProxy.js
const TYPE = { STRING:3, INTEGER:4, BOOLEAN:5, USER:6, CHANNEL:7, ROLE:8, MENTIONABLE:9, NUMBER:10, ATTACHMENT:11 };

function mkGetter(snap, wantType, coerce) {
  return (name, required = false) => {
    const entry = snap.byName[name];
    if (!entry) { if (required) throw new Error(`Required option "${name}" not provided`); return null; }
    if (wantType && entry.type !== wantType) { if (required) throw new Error(`Option "${name}" type mismatch`); return null; }
    return coerce(entry);
  };
}

function buildOptionsProxy(snap) {
  const toString  = e => e.value == null ? null : String(e.value);
  const toInteger = e => e.value == null ? null : parseInt(e.value, 10);
  const toNumber  = e => e.value == null ? null : Number(e.value);
  const toBoolean = e => Boolean(e.value);
  const toUser    = e => e.resolved?.user || (e.value ? { id: e.value } : null);
  const toRole    = e => e.resolved?.role || (e.value ? { id: e.value } : null);
  const toChannel = e => e.resolved?.channel || (e.value ? { id: e.value } : null);
  const toAttach  = e => e.resolved?.attachment || (e.value ? { id: e.value } : null);

  return {
    getSubcommand(required = true) { const v = snap.subcommand; if (!v && required) throw new Error('Subcommand is required'); return v || null; },
    getSubcommandGroup(required = true) { const v = snap.subcommandGroup; if (!v && required) throw new Error('Subcommand group is required'); return v || null; },
    getString:     mkGetter(snap, TYPE.STRING,     toString),
    getInteger:    mkGetter(snap, TYPE.INTEGER,    toInteger),
    getNumber:     mkGetter(snap, TYPE.NUMBER,     toNumber),
    getBoolean:    mkGetter(snap, TYPE.BOOLEAN,    toBoolean),
    getUser:       mkGetter(snap, TYPE.USER,       toUser),
    getRole:       mkGetter(snap, TYPE.ROLE,       toRole),
    getChannel:    mkGetter(snap, TYPE.CHANNEL,    toChannel),
    getAttachment: mkGetter(snap, TYPE.ATTACHMENT, toAttach),
    getRaw(name){ return snap.byName[name] ?? null; },
    names(){ return Object.keys(snap.byName); }
  };
}

module.exports = { buildOptionsProxy, TYPE };