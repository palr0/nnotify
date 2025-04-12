// server.js
import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('✅ 디스코드 봇 서버가 실행 중입니다.');
});

app.listen(PORT, () => {
  console.log(`✅ 웹서버 실행됨 (포트: ${PORT})`);
});
