const mongoose = require('mongoose');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

const subscriberSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  isActive: { type: Boolean, default: false },
  subscriptionExpiry: Date,
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
      sub.isActive = true; sub.subscriptionExpiry = expiry;
      await sub.save();
      const link = await createInviteLink();
      if (link) {
        await sendMessage(sub.userId, `Bienvenido/a ${sub.firstName}!\n\nSuscripcion activada por ${days} dias.\n\nEnlace de acceso:\n${link}\n\nEste enlace es personal. No lo compartas.`);
        await sendMessage(chatId, `Activado: ${sub.firstName} (${targetId}) por ${days} dias. Expira: ${expiry.toLocaleDateString('es-MX')}`);
      } else { await sendMessage(chatId, 'Error al crear enlace. Verifica que el bot sea admin del canal.'); }
      return;
    }
    if (text === '/pendientes') {
      const lista = await Subscriber.find({ isActive: false });
      if (!lista.length) { await sendMessage(chatId, 'No hay solicitudes pendientes.'); return; }
      let r = '<b>Pendientes:</b>\n\n';
      for (const p of lista) r += `ID: <code>${p.userId}</code> - ${p.firstName}\n/aprobar ${p.userId} 30\n\n`;
      await sendMessage(chatId, r); return;
    }
    if (text === '/activos') {
      const lista = await Subscriber.find({ isActive: true });
      if (!lista.length) { await sendMessage(chatId, 'No hay activos.'); return; }
      let r = `<b>Activos: ${lista.length}</b>\n\n`;
      for (const a of lista) r += `${a.firstName} - ID: <code>${a.userId}</code>\nExpira: ${a.subscriptionExpiry ? a.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A'}\n\n`;
      await sendMessage(chatId, r); return;
    }
    if (text.startsWith('/revocar ')) {
      const targetId = parseInt(text.split(' ')[1]);
      const sub = await Subscriber.findOne({ userId: targetId });
      if (!sub) { await sendMessage(chatId, 'Usuario no encontrado.'); return; }
      sub.isActive = false; await sub.save();
      await kickFromChannel(targetId);
      await sendMessage(targetId, 'Tu suscripcion ha sido cancelada.');
      await sendMessage(chatId, `Revocado: ${sub.firstName} (${targetId}).`);
      return;
    }
    if (text === '/ayuda') {
      await sendMessage(chatId, '<b>Comandos Admin:</b>\n/pendientes\n/activos\n/aprobar [id] [dias]\n/revocar [id]');
      return;
    }
  }

  if (text === '/start') {
    let sub = await Subscriber.findOne({ userId: userId });
    if (!sub) {
      sub = new Subscriber({ userId, username: msg.from.username, firstName: msg.from.first_name, lastName: msg.from.last_name });
      await sub.save();
      await sendMessage(chatId, `Hola ${firstName}! Bienvenido al canal de senales crypto.\n\nUsa /suscribir para solicitar acceso.`);
      await sendMessage(ADMIN_CHAT_ID, `Nuevo: ${firstName} (ID: ${userId}) @${msg.from.username || 'N/A'}`);
    } else if (sub.isActive) {
      await sendMessage(chatId, `Bienvenido ${firstName}! Tu suscripcion esta activa.\nExpira: ${sub.subscriptionExpiry ? sub.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A'}\n\nUsa /enlace para acceder al canal.`);
    } else {
      await sendMessage(chatId, `Hola ${firstName}! Tu solicitud esta pendiente.`);
    }
    return;
  }

  if (text === '/suscribir') {
    let sub = await Subscriber.findOne({ userId: userId });
    if (!sub) {
      sub = new Subscriber({ userId, username: msg.from.username, firstName: msg.from.first_name, lastName: msg.from.last_name });
      await sub.save();
    }
    if (sub.isActive) {
      await sendMessage(chatId, 'Ya tienes suscripcion activa. Usa /enlace.');
    } else {
      await sendMessage(chatId, 'Solicitud enviada. El admin te activara pronto.');
      await sendMessage(ADMIN_CHAT_ID, `Solicitud: ${firstName} ID: <code>${userId}</code>\n/aprobar ${userId} 30`, { parse_mode: 'HTML' });
    }
    return;
  }

  if (text === '/enlace') {
    const sub = await Subscriber.findOne({ userId: userId });
    if (!sub || !sub.isActive) { await sendMessage(chatId, 'No tienes suscripcion. Usa /suscribir.'); return; }
    if (sub.subscriptionExpiry && sub.subscriptionExpiry < new Date()) {
      sub.isActive = false; await sub.save();
      await sendMessage(chatId, 'Suscripcion expirada. Usa /suscribir.'); return;
    }
    const link = await createInviteLink();
    if (link) {
      await sendMessage(chatId, `Enlace de acceso (valido 5 min):\n${link}\n\nNo compartas este enlace.`);
    } else { await sendMessage(chatId, 'Error. Contacta admin.'); }
    return;
  }

  if (text === '/estado') {
    const sub = await Subscriber.findOne({ userId: userId });
    if (!sub) { await sendMessage(chatId, 'No tienes cuenta. Usa /start.'); return; }
    await sendMessage(chatId, `<b>Estado:</b> ${sub.isActive ? 'ACTIVA' : 'INACTIVA'}\nExpira: ${sub.subscriptionExpiry ? sub.subscriptionExpiry.toLocaleDateString('es-MX') : 'N/A'}`);
    return;
  }
}

module.exports = { handleUpdate, connectDB };
