// 개선된 보스 시간 계산 코드 포함 전체 코드
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const config = require('./config.env');
const server = require('./server.js');
const axios = require('axios');
require('dotenv').config({ path: './config.env' });
const TOKEN = process.env.TOKEN;
const bossMessages = new Map();
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

client.on('messageCreate', async (message) => {
    if (message.content.startsWith('/시간 한국표준')) {
        const now = new Date();
        const seoulTime = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
        message.channel.send(`현재 한국 표준시(KST)는: ${seoulTime}`);
    }

    if (message.content.startsWith('/시간 조정')) {
        const timeString = message.content.split(' ')[1];
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

const bossSchedule = [
    { minute: 0, boss: '그루트킹' },
    { minute: 30, boss: '해적 선장' },
    { hourType: '홀수', minute: 10, boss: '아절 브루트' },
    { hourType: '짝수', minute: 10, boss: '위더' },
    { hourType: '홀수', minute: 40, boss: '쿵푸' },
    { hourType: '짝수', minute: 40, boss: '에이트' },
    { hourType: '홀수', minute: 50, boss: '세르칸' }
];

function getUpcomingBosses(count = 2) {
    const now = new Date();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const possibleBosses = [];

    for (let offsetHour = 0; offsetHour <= 2; offsetHour++) {
        const checkHour = now.getHours() + offsetHour;

        bossSchedule.forEach(({ hourType, minute, boss }) => {
            const totalMinutes = checkHour * 60 + minute;
            if (totalMinutes <= currentTotalMinutes) return;

            const adjustedHour = minute === 0 ? checkHour - 1 : checkHour;

            if (hourType === '홀수' && adjustedHour % 2 === 0) return;
            if (hourType === '짝수' && adjustedHour % 2 !== 0) return;

            possibleBosses.push({ boss, hour: checkHour, minute, totalMinutes });
        });
    }

    possibleBosses.sort((a, b) => a.totalMinutes - b.totalMinutes);
    return possibleBosses.slice(0, count);
}

async function getSavedMessageId(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': config.JSONBIN_API_KEY }
        });
        return response.data.record[guildId];
    } catch (err) {
        console.error("❌ 메시지 ID 불러오기 실패:", err.message);
        return null;
    }
}

async function saveMessageId(guildId, messageId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': config.JSONBIN_API_KEY }
        });

        const updatedRecord = response.data.record || {};
        updatedRecord[guildId] = messageId;

        await axios.put(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}`, { record: updatedRecord }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.JSONBIN_API_KEY
            }
        });

        console.log(`✅ 메시지 ID 저장됨 (${guildId}): ${messageId}`);
    } catch (err) {
        console.error("❌ 메시지 ID 저장 실패:", err.message);
    }
}

async function updateBossMessage(channel, initialMessage) {
    let guildId = channel.guild?.id || channel.guildId;
    bossMessages.set(guildId, initialMessage);

    setInterval(async () => {
        const now = new Date();
        const bosses = getUpcomingBosses(2);
        if (bosses.length === 0) return;

        const { boss: nextBoss, hour, minute } = bosses[0];
        const nextNextBoss = bosses[1] || { boss: '없음', hour: '-', minute: '-' };

        const targetTime = new Date(now); // now 기준 복사
targetTime.setHours(hour);
targetTime.setMinutes(minute);
targetTime.setSeconds(0);
targetTime.setMilliseconds(0);

if (targetTime < now) {
    targetTime.setDate(targetTime.getDate() + 1); // 다음 날로 보정
}

const remainingTotalSec = Math.max(0, Math.floor((targetTime - now) / 1000));
const remainingMinutes = Math.floor(remainingTotalSec / 60);
const remainingSeconds = remainingTotalSec % 60;


        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('보스 알림 받기')
            .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
            .addFields(
                { name: "📢 다음 보스", value: `**${nextBoss}**\n남은 시간: **${remainingMinutes}분 ${remainingSeconds}초**`, inline: false },
                { name: "⏭️ 그 다음 보스", value: `**${nextNextBoss.boss}** (${nextNextBoss.hour}시 ${nextNextBoss.minute}분)`, inline: false }
            )
            .setFooter({ text: '🔔 클릭해서 알림을 받으세요!' });

        const bossMessage = bossMessages.get(guildId);
        if (bossMessage) {
            await bossMessage.edit({ embeds: [embed] }).catch(console.error);
        }
    }, 2000);
}

client.on('messageReactionAdd', async (reaction, user) => {
    const guildId = reaction.message.guild.id;
    const targetMessage = bossMessages.get(guildId);
    if (!targetMessage || reaction.message.id !== targetMessage.id) return;
    if (reaction.emoji.name !== '🔔') return;
    if (user.bot) return;

    alertUsers.add(user.id);

    try {
        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        let role = guild.roles.cache.find(r => r.name === '보스알림');
        if (!role) {
            role = await guild.roles.create({
                name: '보스알림',
                mentionable: true,
                reason: '보스 알림을 위한 역할 자동 생성'
            });
        }
        await member.roles.add(role);
        console.log(`✅ ${user.tag} 알림 등록됨 및 역할 부여됨`);
    } catch (err) {
        console.error(`❌ 역할 부여 실패: ${err.message}`);
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    const guildId = reaction.message.guild.id;
    const targetMessage = bossMessages.get(guildId);
    if (!targetMessage || reaction.message.id !== targetMessage.id) return;
    if (reaction.emoji.name !== '🔔') return;
    if (user.bot) return;

    alertUsers.delete(user.id);

    try {
        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.find(r => r.name === '보스알림');
        if (role) {
            await member.roles.remove(role);
            console.log(`🔕 ${user.tag} 알림 해제됨 및 역할 제거됨`);
        }
    } catch (err) {
        console.error(`❌ 역할 제거 실패: ${err.message}`);
    }
});

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 봇이 온라인입니다!`);

    client.guilds.cache.forEach(async (guild) => {
        const bossAlertChannel = guild.channels.cache.find(c => c.name === "보스알림");
        if (!bossAlertChannel) {
            console.error(`❌ '${guild.name}' 서버에서 '보스알림' 채널을 찾을 수 없습니다.`);
            return;
        }

        let bossMessage = null;

        try {
            const savedMessageId = await getSavedMessageId(guild.id);
            if (savedMessageId) {
                const fetched = await bossAlertChannel.messages.fetch(savedMessageId, { cache: false, force: true });

                if (fetched && fetched.edit) {
                    bossMessage = fetched;
                    bossMessages.set(guild.id, bossMessage);
                    console.log(`✅ ${guild.name} 서버 이전 메시지 불러오기 성공: ${fetched.id}`);
                }
            }
        } catch (err) {
            console.error(`⚠️ ${guild.name} 서버에서 메시지 불러오기 실패:`, err.message);
        }

        if (!bossMessage || typeof bossMessage.edit !== 'function') {
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('보스 알림 받기')
                .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
                .addFields({ name: "📢 다음 보스", value: `불러오는 중...` })
                .setFooter({ text: '🔔 클릭해서 알림을 받으세요!' });

            bossMessage = await bossAlertChannel.send({ embeds: [embed] });
            await bossMessage.react('🔔');
            bossMessages.set(guild.id, bossMessage);
            await saveMessageId(guild.id, bossMessage.id);
        }

        updateBossMessage(bossAlertChannel, bossMessage);
    });
});

client.login(TOKEN);
