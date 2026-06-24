import http from 'http';

function request(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Cookie'] = `token=${token}`;
    
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let cookies = res.headers['set-cookie'];
        let parsedData = data;
        try { parsedData = JSON.parse(data); } catch(e){}
        resolve({ data: parsedData, cookies, status: res.statusCode });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const username = 'testuser_' + Date.now();
  const email = username + '@example.com';
  
  console.log("Registering...");
  const reg = await request('/api/auth/register', 'POST', {
    username, email, password: 'password', displayName: 'Test User'
  });
  console.log(reg.status, reg.data);
  
  let token = null;
  if (reg.cookies) {
    const match = reg.cookies[0].match(/token=([^;]+)/);
    if (match) token = match[1];
  }
  
  console.log("Token:", token);
  
  if (!token) return;

  const me = await request('/api/auth/me', 'GET', null, token);
  console.log("Me:", me.status, me.data);

  const conv = await request('/api/conversations', 'GET', null, token);
  console.log("Conversations:", conv.status, conv.data);
  
  const status = await request('/api/status', 'GET', null, token);
  console.log("Status API:", status.status, status.data);
  
  const privacy = await request('/api/auth/privacy', 'GET', null, token);
  console.log("Privacy GET:", privacy.status, privacy.data);
}

run();
