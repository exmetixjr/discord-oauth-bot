const { connectDB } = require('../../api/utils/db');

async function log(action, performedBy, details = {}) {
  try {
    const db = await connectDB();
    await db.collection('audit_logs').insertOne({ action, performedBy, details, timestamp: new Date() });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { log };
