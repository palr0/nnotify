// server.js
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('디스코드 봇 살아있음!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ 웹서버 실행됨 (포트: ${PORT})`));
