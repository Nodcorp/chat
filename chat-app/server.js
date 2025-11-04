import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = { users: [], groups: [] };
const onlineUsers = {};
const connectedUsers = {};

function getMembers(room) {
  const group = db.groups.find(g => g.id === room);
  if (!group) return [];
  return group.members.map(username => {
    const user = db.users.find(u => u.username === username);
    return {
      username,
      hasProfilePic: !!user?.profilePicBase64,
      online: onlineUsers[room]?.has(username) || false
    };
  });
}
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Missing username or password' });
  if (username.toLowerCase() === 'nodbot' || username.toLowerCase().startsWith('@nodbot'))
    return res.status(403).json({ message: 'This username is reserved' });
  if (db.users.find(u => u.username === username)) return res.status(409).json({ message: 'Username taken' });
  db.users.push({ username, passwordHash: password, profilePicBase64: null, bio: '' });
  res.json({ message: 'Registered' });
});
app.get('/api/user/:username/profile', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ username: user.username, bio: user.bio, hasProfilePic: !!user.profilePicBase64 });
});
app.post('/api/user/:username/bio', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.bio = req.body.bio || '';
  res.json({ message: 'Bio updated' });
});
app.post('/api/upload-profile', (req, res) => {
  const { username, imageBase64 } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ message: 'User not found' });
  user.profilePicBase64 = imageBase64;
  res.json({ message: 'Profile picture updated' });
});
app.get('/api/user/:username/profile-pic', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user || !user.profilePicBase64) return res.status(404).send();
  const data = user.profilePicBase64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(data, 'base64');
  res.writeHead(200, { 'Content-Type': 'image/png' });
  res.end(buffer);
});
let reports = [];
app.post('/api/report/:username', (req, res) => {
  const username = req.params.username;
  if (!db.users.find(u => u.username === username)) return res.status(404).json({ message: 'User not found' });
  if (!reports.includes(username)) reports.push(username);
  io.emit('reportsUpdate', reports);
  res.json({ message: `Reported ${username}` });
});
app.post('/secret/delete-user', (req, res) => {
  const key = req.query.key;
  if (key !== process.env.SECRET_KEY) return res.status(403).send('Forbidden');
  const { username } = req.body;
  const index = db.users.findIndex(u => u.username === username);
  if (index !== -1) db.users.splice(index, 1);
  db.groups.forEach(g => {
    g.members = g.members.filter(u => u !== username);
    g.messages = g.messages.filter(m => m.username !== username);
  });
  const socketId = connectedUsers[username];
  if (socketId) io.to(socketId).emit('forceLogout');
  reports = reports.filter(u => u !== username);
  io.emit('reportsUpdate', reports);
  res.json({ message: `Deleted user ${username}` });
});

io.on('connection', socket => {
  socket.on('joinRoom', ({ room, username }) => {
    socket.join(room);
    socket.username = username;
    connectedUsers[username] = socket.id;
    if (!onlineUsers[room]) onlineUsers[room] = new Set();
    onlineUsers[room].add(username);
    io.to(room).emit('memberUpdate', getMembers(room));
  });

  socket.on('leaveRoom', ({ room, username }) => {
    socket.leave(room);
    if (onlineUsers[room]) onlineUsers[room].delete(username);
    io.to(room).emit('memberUpdate', getMembers(room));
  });

  socket.on('message', async ({ room, username, text }) => {
    const group = db.groups.find(g => g.id === room);
    if (!group) return;
    group.messages.push({ username, text });
    io.to(room).emit('message', { username, text });

    if (text.includes('@nodbot')) {
      const prevMsg = group.messages[group.messages.length - 2];
      if (prevMsg) {
        const reply = await generateNodbotReply(prevMsg.text);
        group.messages.push({ username: 'nodbot', text: reply });
        io.to(room).emit('message', { username: 'nodbot', text: reply });
      }
    }
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      for (const room in onlineUsers) {
        onlineUsers[room].delete(socket.username);
        io.to(room).emit('memberUpdate', getMembers(room));
      }
      delete connectedUsers[socket.username];
    }
  });
});

async function generateNodbotReply(query) {
  try {
    const search = await fetch(`https://en.wikipedia.org/w/api.php?origin=*&action=query&list=search&format=json&srsearch=${encodeURIComponent(query)}`);
    const searchData = await search.json();
    const title = searchData.query.search[0]?.title;
    if (!title) return "[nodbot]";
    const article = await fetch(`https://en.wikipedia.org/w/api.php?origin=*&action=query&prop=extracts&explaintext=true&format=json&titles=${encodeURIComponent(title)}`);
    const articleData = await article.json();
    const pages = articleData.query.pages;
    const text = Object.values(pages)[0].extract;
    const words = text.split(/\s+/).filter(w => w.length > 2 && /^[A-Za-z]+$/.test(w));
    const chain = {};
    for (let i = 0; i < words.length - 2; i++) {
      const key = words[i].toLowerCase() + " " + words[i + 1].toLowerCase();
      const nextWord = words[i + 2].toLowerCase();
      if (!chain[key]) chain[key] = [];
      chain[key].push(nextWord);
    }
    const keys = Object.keys(chain);
    let seed = keys[Math.floor(Math.random() * keys.length)].split(" ");
    let result = [...seed];
    const sentenceLength = Math.floor(Math.random() * 10) + 10;
    for (let i = 0; i < sentenceLength; i++) {
      const key = result[result.length - 2] + " " + result[result.length - 1];
      const next = chain[key];
      if (!next) break;
      result.push(next[Math.floor(Math.random() * next.length)]);
    }
    let sentence = result.join(" ");
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + [".","?","!","..."][Math.floor(Math.random()*4)];
    return sentence;
  } catch (err) {
    console.error(err);
    return "[nodbot]";
  }
}

server.listen(process.env.PORT || 3000, () => console.log("Chat app running"));
