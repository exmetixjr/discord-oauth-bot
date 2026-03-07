const { connectDB } = require('../../api/utils/db');

async function hasPermission(userId) {
  if (userId === process.env.BOT_OWNER_ID) return true;
  const db = await connectDB();
  const grant = await db.collection('permissions').findOne({ userId });
  return !!grant;
}

async function grantPermission(userId, grantedBy) {
  const db = await connectDB();
  await db.collection('permissions').updateOne(
    { userId },
    { $set: { userId, grantedBy, grantedAt: new Date() } },
    { upsert: true }
  );
}

async function revokePermission(userId) {
  const db = await connectDB();
  await db.collection('permissions').deleteOne({ userId });
}

async function listPermissions() {
  const db = await connectDB();
  return db.collection('permissions').find({}).toArray();
}

module.exports = { hasPermission, grantPermission, revokePermission, listPermissions };
