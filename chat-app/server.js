import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import './utils/keepAlive.js';
import { v4 as uuid } from 'uuid';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const db = {
  users: [], // { username, passwordHash, profilePicBase64 }
  groups: [] // { id, name, members, messages: [{username,text}] }
};
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (db.users.find(u => u.username === username))
    return res.status(400).json({ message: 'Username taken' });

  const hash = await bcrypt.hash(password, 10);
  db.users.push({ username, passwordHash: hash });
  res.json({ message: 'Registered' });
});
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(400).json({ message: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(400).json({ message: 'Invalid credentials' });

  res.json({ token: username });
});
app.post('/api/upload-profile', (req, res) => {
  const { username, imageBase64 } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ message: 'User not found' });

  user.profilePicBase64 = imageBase64;
  res.json({ message: 'Profile pic updated' });
});
app.get('/api/user/:username/profile-pic', (req, res) => {
  const user = db.users.find(u => u.username === req.params.username);
  if (!user || !user.profilePicBase64) return res.status(404).send('No pic');
  const base64Data = user.profilePicBase64.split(',')[1];
  const imgBuffer = Buffer.from(base64Data, 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': imgBuffer.length
  });
  res.end(imgBuffer);
});
app.post('/api/groups', (req, res) => {
  const { name, members } = req.body;
  const group = { id: uuid(), name, members, messages: [] };
  db.groups.push(group);
  res.json(group);
});
app.post('/api/groups/:id/add', (req, res) => {
  const { username } = req.body;
  const group = db.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ message: 'Group not found' });
  if (!group.members.includes(username)) group.members.push(username);
  res.json(group);
});
app.post('/api/rooms', (req, res) => {
  const { roomName } = req.body;
  if (!roomName) return res.status(400).json({ message: 'Room name is required' });

  if (db.groups.some(group => group.name === roomName)) {
    return res.status(400).json({ message: 'Room name already taken' });
  }

  const newRoom = { id: uuid(), name: roomName, members: [], messages: [] };
  db.groups.push(newRoom);

  res.json(newRoom);
});

app.get('/api/rooms', (req, res) => {
  res.json(db.groups.map(group => ({ id: group.id, name: group.name })));
});

app.get('/api/groups/:id/messages', (req, res) => {
  const group = db.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ message: 'Group not found' });
  res.json(group.messages);
});

app.get('/ping', (req, res) => res.send('pong'));
io.on('connection', socket => {
  console.log('🟢');

  socket.on('joinRoom', room => socket.join(room));

  socket.on('message', ({ room, username, text }) => {
    const group = db.groups.find(g => g.id === room);
    if (!group) return;
    group.messages.push({ username, text });
    io.to(room).emit('message', { username, text });
  });

  socket.on('disconnect', () => console.log('🔴'));
});

const port = process.env.PORT || 10000;
server.listen(port, () => console.log(`Server running on port ${port}`));
