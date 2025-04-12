import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import './server.js'; // server.js는 ES 모듈 방식으로 작성되어야 함

const bossMessages = new Map();
const alertUsers = new Set();
const TOKEN = process.env.TOKEN;
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;

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
        const seoulTime = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        message.channel.send(`현재 한국 표준시(KST)는: ${seoulTime}`);
    }

    if (message.content.startsWith('/시간 조정')) {
        const timeString = message.content.split(' ')[1];
        if (!timeString || !/^([0-9]{1,2}):([0-9]{2})$/.test(timeString)) {
            return message.channel.send('올바른 시간 형식이 아닙니다. 예: /시간 조정 15:30');
        }

        const [hour, minute] = timeString.split(':').map(Number);
        const now = new Date();
        now.setHours(hour, minute, 0);

        message.channel.send(`시간이 ${hour}:${minute}로 조정되었습니다. 새로운 시간이 설정되었습니다: ${now}`);
    }

    if (message.content.startsWith('/보스 순서')) {
        const bosses = getUpcomingBosses();

        const description = bosses.map(({ boss, date }) => {
            const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            return `**${boss}** - ${timeStr}`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('🕒 앞으로 등장할 보스 순서')
            .setDescription(description || '예정된 보스가 없습니다.');

        message.channel.send({ embeds: [embed] });
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

function getUpcomingBosses() {
    const now = new Date();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const possibleBosses = [];

    for (let offsetHour = 0; offsetHour <= 6; offsetHour++) {
        const checkHour = (now.getHours() + offsetHour) % 24;

        bossSchedule.forEach(({ hourType, minute, boss }) => {
            const totalMinutes = checkHour * 60 + minute;
            if (offsetHour === 0 && totalMinutes <= currentTotalMinutes) return;

            if (hourType === '홀수' && checkHour % 2 === 0) return;
            if (hourType === '짝수' && checkHour % 2 !== 0) return;

            const bossDate = new Date(now);
            bossDate.setHours(checkHour, minute, 0, 0);

            if (bossDate < now) bossDate.setDate(bossDate.getDate() + 1);

            possibleBosses.push({
                boss,
                hour: checkHour,
                minute,
                date: bossDate,
                totalMinutes: bossDate.getHours() * 60 + bossDate.getMinutes(),
            });
        });
    }

    possibleBosses.sort((a, b) => a.date - b.date);
    return possibleBosses;
}

async function getSavedMessageId(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        return response.data.record[guildId];
    } catch (err) {
        console.error("❌ 메시지 ID 불러오기 실패:", err.message);
        return null;
    }
}

async function saveMessageId(guildId, messageId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });

        const updatedRecord = response.data.record || {};
        updatedRecord[guildId] = messageId;

        await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, { record: updatedRecord }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY
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
        const bosses = getUpcomingBosses();
        if (bosses.length === 0) return;

        const { boss: nextBoss, hour, minute } = bosses[0];
        const nextNextBoss = bosses[1] || { boss: '없음', hour: '-', minute: '-' };

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('보스 알림 받기')
            .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
            .addFields(
                { name: "📢 다음 보스", value: `**${nextBoss}** (${hour}시 ${minute}분)`, inline: false },
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
