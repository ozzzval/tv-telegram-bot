const mongoose = require('mongoose');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// Configuracion de pagos
const WALLET_USDT = 'TZ9kpZTxzAZwEAajv5nWhxB8dALPcT8VPS';
const PLANES = {
  '1': { dias: 30, precio: 5, label: '1 mes - 5 USDT' },
  '3': { dias: 90, precio: 10, label: '3 meses - 10 USDT (promo)' }
};

const subscriberSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  isActive: { type: Boolean, default: false },
  subscriptionExpiry: Date,
  pendingPlan: String,
  joinedAt: { type: Date, default: Date.now }
});
const Subscriber = mongoose.models.Subscriber || mongoose.model('Subscriber', subscriberSchema);

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
}

async function sendMessage(chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text: text, parse_mode: 'HTML', ...options };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function kickFromChannel(userId) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: userId, revoke_messages: false })
    });
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/unbanChatMember`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHANNEL_ID, user_id: userId, only_if_banned: true })
    });
  } catch(e) { console.log('Error kick:', e.message); }
}

async function createInviteLink() {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHANNEL_ID, member_limit: 1, expire_date: Math.floor(Date.now()/1000) + 300 })
  });
  const data = await response.json();
  return data.result ? data.result.invite_link : null;
}

async function handleUpdate(update) {
  await connectDB();
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const userId = msg.from.id;
  const firstName = msg.from.first_name || '';

  if (String(userId) === String(ADMIN_CHAT_ID)) {

    if (text.startsWith('/aprobar ')) {
      const parts = text.split(' ');
      const targetId = parseInt(parts[1]);
      const days = parseInt(parts[2]) || 30;
      const sub = await Subscriber.findOne({ userId: targetId });
      if (!sub) { await sendMessage(chatId, `Usuario ${targetId} no encontrado.`); return; }
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      sub.isActive = true;
      sub.subscriptionExpiry = expiry;
      sub.pendingPlan = null;
      await sub.save();
      const link = await createInviteLink();
      if (link) {
        await sendMessage(sub.userId, `Hola ${sub.firstName}! Tu acceso ha sido activado.\n\nSuscripcion: <b>${days} dias</b>\nExpira: <b>${expiry.toLocaleDateString('es-MX')}</b>\n\nEnlace de acceso al canal (valido 5 min):\n${link}\n\nEste enlace es personal e intransferible.`);
        await sendMessage(chatId, `Activado: ${sub.firstName} (${targetId}) por ${days} dias.\nExpira: ${expiry.toLocaleDateString('es-MX')}`);
      } else {
        await sendMessage(chatId, 'Error al crear enlace. Verifica que el bot sea admin del canal.');
      }
      return;
    }

    if (text === '/pendientes') {
      const lista = await Subscriber.find({ isActive: false });
      if (!lista.length) { await sendMessage(chatId, 'No hay solicitudes pendientes.'); return; }
      let r = '<b>Solicitudes pendientes:</b>\n\n';
      for (const p of lista) {
        const plan = p.pendingPlan ? PLANES[p.pendingPlan] : null;
        r += `${p.firstName} (@${p.username || 'N/A'})\nID: <code>${p.userId}</code>\nPlan: ${plan ? plan.label : 'no especificado'}\n/aprobar ${p.userId} ${plan ? plan.dias : 30}\n\n`;
      }
      await sendMessage(chatId, r);
      return;
    }

    if (text === '/activos') {
      const lista = await Subscriber.find({ isActive: true });
      if (!lista.length) { await sendMessage(chatId, 'No hay suscriptores activos.'); return; }
      let r = `<b>Activos: ${lista.length}</b>\n\n`;
      for (const a of lista) r += `${a.firstName} - ID: <code>${a.userId}</code>\nExpira: ${a.subscriptionExpiry ? a.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A'}\n\n`;
      await sendMessage(chatId, r);
      return;
    }

    if (text.startsWith('/revocar ')) {
      const targetId = parseInt(text.split(' ')[1]);
      const sub = await Subscriber.findOne({ userId: targetId });
      if (!sub) { await sendMessage(chatId, 'Usuario no encontrado.'); return; }
      sub.isActive = false;
      await sub.save();
      await kickFromChannel(targetId);
      await sendMessage(targetId, 'Tu suscripcion ha sido cancelada. Usa /suscribir para renovar.');
      await sendMessage(chatId, `Revocado: ${sub.firstName} (${targetId}).`);
      return;
    }

    if (text === '/ayuda') {
      await sendMessage(chatId, '<b>Comandos Admin:</b>\n/pendientes - solicitudes de pago\n/activos - suscriptores activos\n/aprobar [id] [dias] - activar acceso\n/revocar [id] - cancelar suscripcion');
      return;
    }
  }

  if (text === '/start') {
    let sub = await Subscriber.findOne({ userId: userId });
    if (!sub) {
      sub = new Subscriber({ userId, username: msg.from.username, firstName: msg.from.first_name, lastName: msg.from.last_name });
      await sub.save();
    }
    if (sub.isActive && sub.subscriptionExpiry > new Date()) {
      await sendMessage(chatId, `Hola ${firstName}! Tu suscripcion esta activa hasta el ${sub.subscriptionExpiry.toLocaleDateString('es-MX')}.\n\nUsa /enlace para acceder al canal.`);
    } else {
      await sendMessage(chatId, `Hola ${firstName}! Bienvenido a <b>Senales Cryptoz</b>.\n\nAccede a senales de trading de criptomonedas en tiempo real.\n\nUsa /suscribir para ver los planes disponibles.`);
    }
    return;
  }

  if (text === '/suscribir') {
    let sub = await Subscriber.findOne({ userId: userId });
    if (!sub) {
      sub = new Subscriber({ userId, username: msg.from.username, firstName: msg.from.first_name, lastName: msg.from.last_name });
      await sub.save();
    }
    if (sub.isActive && sub.subscriptionExpiry > new Date()) {
      await sendMessage(chatId, `Ya tienes suscripcion activa hasta el ${sub.subscriptionExpiry.toLocaleDateString('es-MX')}.\n\nUsa /enlace para acceder al canal.`);
      return;
    }
    await sendMessage(chatId, `<b>Planes disponibles:</b>\n\n1. <b>1 mes</b> - 5 USDT\n2. <b>3 meses</b> - 10 USDT (promo especial)\n\nElige tu plan:\n/plan1 - 1 mes (5 USDT)\n/plan3 - 3 meses (10 USDT)`);
    return;
  }

  if (text === '/plan1' || text === '/plan3') {
    const planKey = text === '/plan1' ? '1' : '3';
    const plan = PLANES[planKey];
    let sub = await Subscriber.findOne({ userId: userId });
    if (!sub) {
      sub = new Subscriber({ userId, username: msg.from.username, firstName: msg.from.first_name, lastName: msg.from.last_name });
    }
    sub.pendingPlan = planKey;
    await sub.save();
    await sendMessage(chatId, `<b>Plan: ${plan.label}</b>\n\nEnvia exactamente <b>${plan.precio} USDT</b> en red <b>TRC20 (TRON)</b> a:\n\n<code>${WALLET_USDT}</code>\n\nSolo red TRON (TRC20). No envies por otra red.\n\nUna vez realizado el pago, envia el hash:\n/pago [hash de la transaccion]`);
    return;
  }

  if (text.startsWith('/pago ')) {
    const hash = text.replace('/pago ', '').trim();
    if (!hash || hash.length < 10) {
      await sendMessage(chatId, 'Envia el hash completo.\nEjemplo: /pago abc123...');
      return;
    }
    const sub = await Subscriber.findOne({ userId: userId });
    const plan = sub && sub.pendingPlan ? PLANES[sub.pendingPlan] : PLANES['1'];
    const tronscanUrl = `https://tronscan.org/#/transaction/${hash}`;
    await sendMessage(chatId, `Comprobante recibido! El admin verificara tu pago y activara tu acceso en breve.\n\nPlan: ${plan.label}`);
    await sendMessage(ADMIN_CHAT_ID, `PAGO RECIBIDO\n\nUsuario: ${firstName} (@${msg.from.username || 'N/A'})\nID: <code>${userId}</code>\nPlan: ${plan.label}\nHash: <code>${hash}</code>\n\nVerificar:\n${tronscanUrl}\n\n/aprobar ${userId} ${plan.dias}`);
    return;
  }

  if (text === '/enlace') {
    const sub = await Subscriber.findOne({ userId: userId });
    if (!sub || !sub.isActive) { await sendMessage(chatId, 'No tienes suscripcion activa. Usa /suscribir.'); return; }
    if (sub.subscriptionExpiry && sub.subscriptionExpiry < new Date()) {
      sub.isActive = false;
      await sub.save();
      await sendMessage(chatId, 'Tu suscripcion ha expirado. Usa /suscribir para renovar.');
      return;
    }
    const link = await createInviteLink();
    if (link) {
      await sendMessage(chatId, `Enlace de acceso (valido 5 minutos):\n${link}\n\nNo compartas este enlace.`);
    } else {
      await sendMessage(chatId, 'Error al generar enlace. Contacta al admin.');
    }
    return;
  }

  if (text === '/estado') {
    const sub = await Subscriber.findOne({ userId: userId });
    if (!sub) { await sendMessage(chatId, 'No tienes cuenta. Usa /start.'); return; }
    const activa = sub.isActive && sub.subscriptionExpiry > new Date();
    await sendMessage(chatId, `<b>Tu suscripcion:</b>\nEstado: ${activa ? 'ACTIVA' : 'INACTIVA'}\nExpira: ${sub.subscriptionExpiry ? sub.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A'}`);
    return;
  }

  if (text === '/renovar') {
    await sendMessage(chatId, 'Para renovar usa /suscribir.');
    return;
  }

}

module.exports = { handleUpdate, connectDB };
