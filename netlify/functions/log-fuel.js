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

async function ensureConfigSheet(sheets, spreadsheetId) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Config' } } }] }
    });
  } catch (e) {
    // Tab likely already exists — safe to continue
  }
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

  // ---------- GET ----------
  if (event.httpMethod === 'GET') {
    const qs = event.queryStringParameters || {};

    // Shared config: aircraft list + tank calibration/levels
    if (qs.resource === 'config') {
      try {
        const sheets = google.sheets({ version: 'v4', auth: getAuth() });
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'Config'!A1:B2`
        });
        const rows = res.data.values || [];
        let aircraft = [];
        let tanks = null;
        for (const row of rows) {
          if (row[0] === 'aircraft_json' && row[1]) {
            try { aircraft = JSON.parse(row[1]); } catch (e) {}
          }
          if (row[0] === 'tanks_json' && row[1]) {
            try { tanks = JSON.parse(row[1]); } catch (e) {}
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ aircraft, tanks }) };
      } catch (err) {
        return { statusCode: 200, headers, body: JSON.stringify({ aircraft: [], tanks: null }) };
      }
    }

    // Ledger rows for a given fuel type
    const fuelType = qs.fuelType || '';
    if (!fuelType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fuelType query param' }) };
    }
    const sheetName = 'Fuel Log - ' + fuelType;
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:H10000`
      });
      return { statusCode: 200, headers, body: JSON.stringify({ rows: res.data.values || [] }) };
    } catch (err) {
      return { statusCode: 200, headers, body: JSON.stringify({ rows: [] }) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ---------- POST ----------
  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // Save shared config: aircraft list + tank calibration/levels
  if (data.resource === 'config') {
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      await ensureConfigSheet(sheets, spreadsheetId);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Config'!A1:B2`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['aircraft_json', JSON.stringify(data.aircraft || [])],
            ['tanks_json', JSON.stringify(data.tanks || {})]
          ]
        }
      });
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // Append a new fueling record
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
    } catch (e) {
      // Tab likely already exists — safe to continue
    }

    // Always keep the header row current, even for tabs created before this schema existed
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Timestamp', 'Aircraft Registration', 'Date', 'Fuel Type', 'Meter Before (L)', 'Meter After (L)', 'Liters', 'Running Total (L)']]
      }
    });

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
          data.meterBefore,
          data.meterAfter,
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
