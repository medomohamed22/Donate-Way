// server.js
import express from 'express';
import cors from 'cors';
// npm install express cors axios

// للاستخدام الحقيقي استخدم الحزمة الرسمية: npm install pi-backend
// هنا مثال مبسط فقط

const app = express();
app.use(express.json());
app.use(cors());

const YOUR_API_KEY = "xxxxxxxxxxxxxxxxxxxx";        // ← من Developer Portal
const YOUR_WALLET_PRIVATE_SEED = "Sxxxxxxxxxxxxxxxx"; // ← خطير!! احفظه في .env

app.post('/approve-payment', async (req, res) => {
  const { paymentId, accessToken } = req.body;
  console.log(`[APPROVE] paymentId: ${paymentId}`);

  try {
    // هنا يجب أن ترسل طلب POST إلى Pi Platform API
    // /v2/payments/{paymentId}/approve
    // مع Authorization: Bearer YOUR_API_KEY
    // و body: { paymentId }

    // مثال باستخدام axios:
    /*
    const response = await axios.post(
      `https://api.minepi.com/v2/payments/${paymentId}/approve`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${YOUR_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log("تمت الموافقة:", response.data);
    */

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/complete-payment', async (req, res) => {
  const { paymentId, txid } = req.body;
  console.log(`[COMPLETE] paymentId: ${paymentId} | txid: ${txid}`);

  // هنا ترسل طلب POST إلى /v2/payments/{paymentId}/complete
  // مع body: { txid }

  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('Server running → http://localhost:3000');
});
