const { handleUpdate } = require('../index');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.status(200).json({ status: 'Bot de Senales Crypto - ACTIVO', version: '2.0' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const update = req.body;
    await handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: false, error: error.message });
  }
};
