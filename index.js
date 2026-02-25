import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

app.get("/", (req, res) => {
  res.send("Bot TradingView -> Telegram activo!");
});

app.post("/tradingview", async (req, res) => {
  try {
    const alert = req.body;

    const symbol = alert.symbol || "SIN_SIMBOLO";
    const price  = alert.price  || "0";
    const side   = alert.side   || "N/A";
    const time   = alert.time   || "";

    const emoji = side.toUpperCase() === "BUY" ? "🟢" : "🔴";

    const text =
      `${emoji} <b>SEÑAL TRADINGVIEW</b>\n` +
      `📌 Simbolo: <b>${symbol}</b>\n` +
      `📊 Accion:  <b>${side.toUpperCase()}</b>\n` +
      `💰 Precio:  <b>${price}</b>\n` +
      (time ? `🕐 Hora: ${time}` : "");

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML"
      })
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor activo en puerto", PORT));
