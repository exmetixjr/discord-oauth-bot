const { connectDB } = require('./utils/db');

module.exports = async (req, res) => {
  const { code, error } = req.query;

  // If user denied authorization
  if (error) {
    return res.redirect('/?error=denied');
  }

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
    // Step 1: Exchange code for access_token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return res.redirect('/?error=token_failed');
    }

    // Step 2: Fetch user info using the access_token
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const user = await userResponse.json();

    if (!user.id) {
      return res.redirect('/?error=user_failed');
    }

    // Step 3: Save to database
    const db = await connectDB();
    const collection = db.collection('authorized_users');

    // Upsert — update if exists, insert if new
    await collection.updateOne(
      { userId: user.id },
      {
        $set: {
          userId: user.id,
          username: user.username,
          globalName: user.global_name || user.username,
          avatar: user.avatar,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpires: new Date(Date.now() + tokenData.expires_in * 1000),
          authorizedAt: new Date(),
        },
        $setOnInsert: {
          firstAuthorizedAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(`✅ User authorized: ${user.username} (${user.id})`);

    // Redirect to success page
    return res.redirect(`/?success=true&user=${encodeURIComponent(user.global_name || user.username)}`);

  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};