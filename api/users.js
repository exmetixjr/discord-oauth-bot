const { connectDB } = require('./utils/db');

module.exports = async (req, res) => {
  // Simple auth check — only your bot's owner can call this
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.BOT_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = await connectDB();
  const collection = db.collection('authorized_users');

  const users = await collection
    .find({})
    .sort({ authorizedAt: -1 })
    .toArray();

  // Don't expose tokens in API response
  const safeUsers = users.map(({ accessToken, refreshToken, ...safe }) => safe);

  return res.json({ count: safeUsers.length, users: safeUsers });
};