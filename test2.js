import http from 'http';

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/privacy',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json'
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Privacy PUT:', data));
});
req.write(JSON.stringify({
  profilePhotoPrivacy: 'EVERYONE',
  statusPrivacy: 'MY_CONTACTS_EXCEPT',
  lastSeenPrivacy: 'EVERYONE',
  onlineStatusPrivacy: 'EVERYONE',
  statusPrivacyExceptions: [{ targetUserId: 'invalid-uuid', type: 'EXCLUDED' }]
}));
req.end();
