exports.handler = async (event) => {
  console.log("=== APPROVE FUNCTION CALLED ===");
  console.log("Time:", new Date().toISOString());

  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  const { paymentId } = JSON.parse(event.body || '{}');
  if (!paymentId) return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Missing paymentId' }) };

  // الـ Key دلوقتي بييجي من Environment Variable (آمن تمامًا)
  const apiKey = process.env.PI_API_KEY;

  if (!apiKey) {
    console.log("ERROR: PI_API_KEY not set!");
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Server configuration error' }) };
  }

  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      console.log("APPROVAL SUCCESS");
      return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
    } else {
      const err = await response.text();
      console.log("APPROVAL FAILED:", err);
      return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err }) };
    }
  } catch (err) {
    console.log("ERROR:", err.message);
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err.message }) };
  }
};
