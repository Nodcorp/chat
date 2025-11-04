import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const target = process.env.PING_URL;
if (target) {
  console.log(`Keep-alive ping enabled for ${target}`);
  setInterval(async () => {
    try {
      const res = await fetch(`${target}/ping`);
      console.log(`Pinged ${target}/ping - ${res.status}`);
    } catch (err) {
      console.error('Ping failed:', err.message);
    }
  }, 12 * 60 * 1000);
}
