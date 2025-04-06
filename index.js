const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const config = require('./config.env');
const server = require('./server.js');
const axios = require('axios');
require('dotenv').config({ path: './config.env' });
const TOKEN = process.env.TOKEN;
const bossMessages = new Map(); // key: guild.id, value: message
const alertUsers = new Set();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// /시간 한국표준 명령어 처리
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('/시간 한국표준')) {
        const now = new Date();
        const seoulTime = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
        message.channel.send(`현재 한국 표준시(KST)는: ${seoulTime}`);
    }

    // /시간 조정 시:분 명령어 처리
    if (message.content.startsWith('/시간 조정')) {
        const timeString = message.content.split(' ')[1]; // "시:분" 형식
        if (!timeString || !/^([0-9]{1,2}):([0-9]{2})$/.test(timeString)) {
            return message.channel.send('올바른 시간 형식이 아닙니다. 예: /시간 조정 15:30');
        }

        const [hour, minute] = timeString.split(':').map(Number);
        const now = new Date();
        now.setHours(hour);
        now.setMinutes(minute);
        now.setSeconds(0);

        message.channel.send(`시간이 ${hour}:${minute}로 조정되었습니다. 새로운 시간이 설정되었습니다: ${now}`);
    }
});

// 봇 준비가 완료되었을 때 실행되는 코드
client.once('ready', () => {
    console.log(`✅ ${client.user.tag} 봇이 온라인입니다!`);
});

client.login(TOKEN).catch(err => console.error("❌ ERROR: 디스코드 봇 로그인 실패!", err));
