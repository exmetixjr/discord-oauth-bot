const { MongoClient } = require('mongodb');

let client;
let db;

async function connectDB() {
  if (db) return db; // Return cached connection

  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db('authbot');
  console.log('✅ Connected to MongoDB');
  return db;
}

module.exports = { connectDB };