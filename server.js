import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('✅ 디스코드 봇 서버가 실행 중입니다.');
});

app.get('/ping', (req, res) => {
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`✅ 웹서버 실행됨 (포트: ${PORT})`);
    
    // 14분마다 서버 핑 (모든 환경에서 실행)
    const pingInterval = setInterval(() => {
        const baseUrl = process.env.RENDER 
            ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:'+PORT}`
            : `http://localhost:${PORT}`;
            
        fetch(`${baseUrl}/ping`)
            .then(() => console.log(`[${new Date().toISOString()}] 🏓 서버 핑 성공`))
            .catch(err => console.error(`[${new Date().toISOString()}] ❌ 서버 핑 실패:`, err.message));
    }, 14 * 60 * 1000);

    // 종료 시 인터벌 정리
    process.on('SIGINT', () => {
        clearInterval(pingInterval);
        console.log('🛑 서버 핑 인터벌 정리됨');
    });
});

export default app;
