const mongoose = require('mongoose');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// Configuracion de pagos
const WALLET_USDT = 'TZ9kpZTxzAZwEAajv5nWhxB8dALPcT8VPS';
const PLANES = {
  '0': { dias: 30, precio: 1, label: 'PRUEBA 1 mes - 1 USDT' },
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
  planTipo: { type: String, enum: ['0', '1', '3'], default: null },
  recordatorioEnviado: { type: Boolean, default: false },
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

async function handleUpdate(update) {
  await connectDB();
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const userId = msg.from.id;
  const firstName = msg.from.first_name || '';

  // ADMIN COMMANDS
  if (String(userId) === String(ADMIN_CHAT_ID)) {
    if (text.startsWith('/aprobar ')) {
      const parts = text.split(' ');
      const targetId = parseInt(parts[1]);
      const days = parseInt(parts[2]) || 30;
      const sub = await Subscriber.findOne({ userId: targetId });
      if (!sub) return;

      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      sub.isActive = true;
      sub.subscriptionExpiry = expiry;
      sub.planTipo = sub.pendingPlan || (days === 30 ? '1' : '3');
      sub.pendingPlan = null;
      sub.recordatorioEnviado = false;
      await sub.save();

      await sendMessage(sub.userId, `🎉 ¡Tu acceso ha sido activado! Expiración: ${expiry.toLocaleDateString('es-MX')}`);
      await sendMessage(chatId, `Usuario ${targetId} activado.`);
      return;
    }
  }

  // USER COMMANDS
  if (text === '/start') {
    await sendMessage(chatId, `Hola ${firstName}! Usa /suscribir para ver los planes.`);
    return;
  }

  if (text === '/suscribir') {
    let sub = await Subscriber.findOne({ userId });
    if (sub && sub.isActive && sub.subscriptionExpiry > new Date()) {
      await sendMessage(chatId, "Ya tienes una suscripción activa.");
      return;
    }
    await sendMessage(chatId, `<b>Planes disponibles:</b>

0. <b>PRUEBA 1 mes</b> - 1 USDT
1. <b>1 mes</b> - 5 USDT
2. <b>3 meses</b> - 10 USDT

Usa:
/plan0 para prueba

  if (text === '/plan0' || text === '/plan1' || text === '/plan3') {
    const key = text.replace('/plan', '');
    const plan = PLANES[key];
    await Subscriber.findOneAndUpdate({ userId }, { pendingPlan: key }, { upsert: true });
    await sendMessage(chatId, `<b>Has elegido: ${plan.label}</b>

Envía ${plan.precio} USDT (TRC20) a:
<code>${WALLET_USDT}</code>

Envía /pago [hash] al terminar.`);
    return;
  }
}

module.exports = { handleUpdate, connectDB };
