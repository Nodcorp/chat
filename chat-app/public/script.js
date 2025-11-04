let socket;

function register() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const file = document.getElementById('profilePic').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => doRegister(username, password, reader.result);
    reader.readAsDataURL(file);
  } else doRegister(username, password, null);
}

function doRegister(username, password, base64) {
  fetch('/api/register', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username,password})
  }).then(r=>r.json()).then(data=>{
    document.getElementById('status').innerText = data.message || 'Registered';
    if(base64){
      fetch('/api/upload-profile', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({username,imageBase64:base64})
      });
    }
  });
}


function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  fetch('/api/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username,password})
  }).then(r=>r.json()).then(data=>{
    if(data.token){
      localStorage.setItem('token', data.token);
      window.location='/chat.html';
    } else document.getElementById('status').innerText = data.message;
  });
}

function joinRoom() {
  const room = document.getElementById('room').value;
  socket = io();
  socket.emit('joinRoom', room);
  socket.on('message', data=>{
    const msgDiv = document.getElementById('messages');
    msgDiv.innerHTML += `<div><b>${data.username}</b>: ${data.text}</div>`;
  });
}

function sendMsg() {
  const room = document.getElementById('room').value;
  const msg = document.getElementById('msg').value;
  const username = localStorage.getItem('token') || 'You';
  socket.emit('message', { room, username, text: msg });
  document.getElementById('msg').value='';
}
