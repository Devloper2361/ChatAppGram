const http = require('http');

async function test() {
  const loginRes = await fetch("http://127.0.0.1:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_avatar_user_" + Date.now(), email: "test_avatar_" + Date.now() + "@example.com", password: "password123" })
  });
  
  const cookie = loginRes.headers.get("set-cookie");
  const base64Avatar = "data:image/png;base64," + "A".repeat(4 * 1024 * 1024);
  
  const updateRes = await fetch("http://127.0.0.1:3000/api/auth/profile", {
    method: "PUT",
    headers: { 
      "Content-Type": "application/json",
      "Cookie": cookie
    },
    body: JSON.stringify({ displayName: "Test", bio: "Bio", avatar_url: base64Avatar })
  });
  
  console.log("Update status:", updateRes.status);
  const updateBody = await updateRes.text();
  console.log("Update response:", updateBody.substring(0, 100));
}
test().catch(console.error);
