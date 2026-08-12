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

// The tabs that hold actual logged data (never includes Config — that holds settings, not history)
const ALL_DATA_TABS = [
  { name: 'Fuel Log - 100LL', range: 'A1:M10000' },
  { name: 'Fuel Log - JETA1', range: 'A1:M10000' },
  { name: 'Tank Readings - 100LL', range: 'A1:D10000' },
  { name: 'Tank Readings - JETA1', range: 'A1:D10000' }
];

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

    // Shared config: aircraft list + tank calibration/levels + system passkey + sign contact info
    if (qs.resource === 'config') {
      try {
        const sheets = google.sheets({ version: 'v4', auth: getAuth() });
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'Config'!A1:B5`
        });
        const rows = res.data.values || [];
        let aircraft = [];
        let tanks = null;
        let passkey = null;
        let contactName = null;
        let contactPhone = null;
        for (const row of rows) {
          if (row[0] === 'aircraft_json' && row[1]) {
            try { aircraft = JSON.parse(row[1]); } catch (e) {}
          }
          if (row[0] === 'tanks_json' && row[1]) {
            try { tanks = JSON.parse(row[1]); } catch (e) {}
          }
          if (row[0] === 'passkey' && row[1]) {
            passkey = row[1];
          }
          if (row[0] === 'contact_name' && row[1]) {
            contactName = row[1];
          }
          if (row[0] === 'contact_phone' && row[1]) {
            contactPhone = row[1];
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ aircraft, tanks, passkey, contactName, contactPhone }) };
      } catch (err) {
        // Config tab doesn't exist yet — nothing has been saved there
        return { statusCode: 200, headers, body: JSON.stringify({ aircraft: [], tanks: null, passkey: null, contactName: null, contactPhone: null }) };
      }
    }

    // Full backup export: every logged data tab, headers included
    if (qs.resource === 'export') {
      const tabs = {};
      try {
        const sheets = google.sheets({ version: 'v4', auth: getAuth() });
        for (const tab of ALL_DATA_TABS) {
          try {
            const res = await sheets.spreadsheets.values.get({
              spreadsheetId,
              range: `'${tab.name}'!${tab.range}`
            });
            tabs[tab.name] = res.data.values || [];
          } catch (e) {
            tabs[tab.name] = []; // tab doesn't exist yet — nothing logged for it
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ tabs }) };
      } catch (err) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
      }
    }

    // Ledger rows for a given fuel type
    const fuelType = qs.fuelType || '';
    if (!fuelType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fuelType query param' }) };
    }

    // Tank level / refill reading history for a given fuel type
    if (qs.resource === 'tank_readings') {
      const sheetName = 'Tank Readings - ' + fuelType;
      try {
        const sheets = google.sheets({ version: 'v4', auth: getAuth() });
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A2:D10000`
        });
        return { statusCode: 200, headers, body: JSON.stringify({ rows: res.data.values || [] }) };
      } catch (err) {
        return { statusCode: 200, headers, body: JSON.stringify({ rows: [] }) };
      }
    }

    const sheetName = 'Fuel Log - ' + fuelType;
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A2:M10000`
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

  // Save shared config: aircraft list + tank calibration/levels + system passkey + sign contact info
  if (data.resource === 'config') {
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      await ensureConfigSheet(sheets, spreadsheetId);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'Config'!A1:B5`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [
            ['aircraft_json', JSON.stringify(data.aircraft || [])],
            ['tanks_json', JSON.stringify(data.tanks || {})],
            ['passkey', data.passkey || ''],
            ['contact_name', data.contactName || ''],
            ['contact_phone', data.contactPhone || '']
          ]
        }
      });
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // Log a tank level reading (e.g. a refill), with an optional short note
  // Clear all logged data (fuel logs + tank readings) — never touches Config (aircraft list,
  // calibration, passkey). Requires an exact confirmation token so this can never fire by accident.
  if (data.resource === 'clear_all_data') {
    if (data.confirm !== 'CLEAR_ALL_DATA') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or incorrect confirmation token' }) };
    }
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      for (const tab of ALL_DATA_TABS) {
        try {
          // Clear from row 2 onward — the header row is left in place
          const headerRange = tab.range.replace(/^A1/, 'A2');
          await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `'${tab.name}'!${headerRange}`
          });
        } catch (e) {
          // Tab doesn't exist yet — nothing to clear, safe to continue
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (data.resource === 'tank_reading') {
    if (!data.fuelType || data.level === undefined || data.level === null) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fuelType or level' }) };
    }
    try {
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      const sheetName = 'Tank Readings - ' + data.fuelType;

      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
        });
      } catch (e) {
        // Tab likely already exists — safe to continue
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1:D1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Timestamp', 'Fuel Type', 'Recorded Level (L)', 'Note']]
        }
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetName}'!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            new Date().toISOString(),
            data.fuelType,
            data.level,
            data.note || ''
          ]]
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
      range: `'${sheetName}'!A1:M1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [['Timestamp', 'Aircraft Registration', 'Date', 'Fuel Type', 'Meter Before (L)', 'Meter After (L)', 'Liters', 'Running Total (L)', 'Logged By', 'Address', 'Phone', 'Email', 'Name']]
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
          data.total,
          data.loggedBy || '',
          data.address || '',
          data.phone || '',
          data.email || '',
          data.name || ''
        ]]
      }
    });

    return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
