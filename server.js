import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

// 기본 핑 경로
app.get('/', (req, res) => {
    res.send('✅ 디스코드 봇 서버가 실행 중입니다.');
});

// 추가 핑 경로 (선택 사항)
app.get('/ping', (req, res) => {
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`✅ 웹서버 실행됨 (포트: ${PORT})`);
    
    // 15분마다 자기 자신을 호출 (선택 사항)
    if (process.env.RENDER) {
        // server.js 수정
setInterval(() => {
    const baseUrl = process.env.RENDER 
        ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
        : `http://localhost:${PORT}`;
    fetch(`${baseUrl}/ping`)
        .catch(err => console.error('핑 실패:', err));
}, 14 * 60 * 1000);
    }
});

export default app;
