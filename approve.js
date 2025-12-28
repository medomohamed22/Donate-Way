exports.handler = async (event) => {
  console.log("=== APPROVE FUNCTION TRIGGERED ===");
  console.log("Time:", new Date().toISOString());
  console.log("HTTP Method:", event.httpMethod);
  console.log("Body:", event.body);

  // تحقق من الطريقة
  if (event.httpMethod !== 'POST') {
    console.log("Wrong method:", event.httpMethod);
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // استخراج paymentId
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    console.log("JSON parse error:", e.message);
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Invalid JSON' }) };
  }

  const { paymentId } = payload;

  if (!paymentId) {
    console.log("Missing paymentId");
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Missing paymentId' }) };
  }

  console.log("Received paymentId:", paymentId);

  // قراءة الـ API Key
  const apiKey = process.env.PI_API_KEY;

  console.log("PI_API_KEY exists:", !!apiKey);
  if (apiKey) {
    console.log("PI_API_KEY preview (first 10 chars):", apiKey.substring(0, 10) + "...");
  } else {
    console.log("CRITICAL: PI_API_KEY IS MISSING OR EMPTY!");
  }

  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'PI_API_KEY missing' }) };
  }

  try {
    console.log("Sending approval request to Pi API...");
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("Pi API Response Status:", response.status);

    if (response.ok) {
      console.log("APPROVAL SUCCESSFUL!");
      return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
    } else {
      const errText = await response.text();
      console.log("APPROVAL FAILED:", response.status, errText);
      return { statusCode: 500, body: JSON.stringify({ status: 'error', message: errText }) };
    }
  } catch (err) {
    console.log("Fetch ERROR:", err.message);
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err.message }) };
  }
};
