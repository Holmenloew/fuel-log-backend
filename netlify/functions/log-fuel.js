const { google } = require('googleapis');

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (!process.env.FUEL_LOG_API_KEY || apiKey !== process.env.FUEL_LOG_API_KEY) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const spreadsheetId = process.env.SHEET_ID;

  // ---------- GET: read back the rows actually stored in the sheet ----------
  if (event.httpMethod === 'GET') {
    const fuelType = (event.queryStringParameters && event.queryStringParameters.fuelType) || '';
    if (!fuelType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fuelType query param' }) };
    }
    const sheetName = 'Fuel Log - ' + fuelType;
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:F10000`
      });
      return { statusCode: 200, headers, body: JSON.stringify({ rows: res.data.values || [] }) };
    } catch (err) {
      // Tab doesn't exist yet if nothing has been logged for this fuel type
      return { statusCode: 200, headers, body: JSON.stringify({ rows: [] }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ---------- POST: append a new fueling record ----------
  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!data.reg || !data.date || !data.liters || !data.fuelType) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const sheetName = 'Fuel Log - ' + data.fuelType;

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
      });
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Timestamp', 'Aircraft Registration', 'Date', 'Fuel Type', 'Liters', 'Running Total (L)']]
        }
      });
    } catch (e) {
      // Tab likely already exists — safe to continue
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          new Date().toISOString(),
          data.reg,
          data.date,
          data.fuelType,
          data.liters,
          data.total
        ]]
      }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
