const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const config = require('./config.env');
const server = require('./server.js');
const fs = require('fs');
const { Message } = require('discord.js'); // 메시지 타입 체크용
const path = './bossMessageId.txt';
const axios = require('axios');
//const fetched = await bossAlertChannel.messages.fetch(savedMessageId, { cache: false, force: true });

const TOKEN = config.TOKEN;

const alertUsers = new Set(); // 이모지를 누른 유저 ID 저장
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

let bossMessage;
let currentBossIndex = 0;

const bossSchedule = [
    { minute: 0, boss: '그루트킹' },
    { minute: 30, boss: '해적 선장' },
    { hourType: '홀수', minute: 10, boss: '아절 브루트' },
    { hourType: '짝수', minute: 10, boss: '위더' },
    { hourType: '홀수', minute: 40, boss: '쿵푸' },
    { hourType: '짝수', minute: 40, boss: '에이트' },
    { hourType: '홀수', minute: 50, boss: '세르칸' }
];

function getNextBoss() {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes(); // 현재 시간(분)

    for (let i = 0; i < bossSchedule.length; i++) {
        let { hourType, minute, boss } = bossSchedule[i];
        const bossHour = now.getHours();
        const bossTime = bossHour * 60 + minute;

        if (hourType === '홀수' && bossHour % 2 === 0) continue;
        if (hourType === '짝수' && bossHour % 2 !== 0) continue;

        if (bossTime > currentTime) {
            currentBossIndex = i;
            return { boss, hour: bossHour, minute };
        }
    }

    // 다음 시간대의 첫 보스 반환
    const nextHour = now.getHours() + 1;
    for (let i = 0; i < bossSchedule.length; i++) {
        let { hourType, minute, boss } = bossSchedule[i];
        if (hourType === '홀수' && nextHour % 2 === 0) continue;
        if (hourType === '짝수' && nextHour % 2 !== 0) continue;

        currentBossIndex = i;
        return { boss, hour: nextHour, minute };
    }

    // 아무 조건도 맞지 않을 경우 fallback
    return { boss: '알 수 없음', hour: now.getHours(), minute: now.getMinutes() };
}

async function getSavedMessageId() {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}/latest`, {
            headers: {
                'X-Master-Key': config.JSONBIN_API_KEY
            }
        });
        return response.data.record.messageId;
    } catch (err) {
        console.error("❌ 메시지 ID 불러오기 실패:", err.message);
        return null;
    }
}

async function saveMessageId(id) {
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}`, {
            messageId: id
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': config.JSONBIN_API_KEY
            }
        });
        console.log(`✅ 메시지 ID 저장됨: ${id}`);
    } catch (err) {
        console.error("❌ 메시지 ID 저장 실패:", err.message);
    }
}

async function updateBossMessage(channel) {
    while (true) {
        const now = new Date();
        let { boss, hour, minute } = getNextBoss();

        let remainingMinutes = minute - now.getMinutes() - 1;
        let remainingSeconds = 60 - now.getSeconds();

        if (remainingMinutes < 0 || (remainingMinutes === 0 && remainingSeconds <= 0)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('보스 알림 받기')
            .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
            .addFields({ name: "📢 다음 보스", value: `**${boss}** 남은 시간: **${remainingMinutes}분 ${remainingSeconds}초**` })
            .setFooter({ text: '🔔 클릭해서 알림을 받으세요!' });

        if (bossMessage) {
            await bossMessage.edit({ embeds: [embed] });
        } else {
            bossMessage = await channel.send({ embeds: [embed] });
            await bossMessage.react('🔔');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.message.id !== bossMessage?.id) return;
    if (reaction.emoji.name !== '🔔') return;
    if (user.bot) return;

    alertUsers.add(user.id);

    try {
        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        let role = guild.roles.cache.find(r => r.name === '보스알림');
        if (!role) {
            // 역할이 없으면 생성
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
    if (reaction.message.id !== bossMessage?.id) return;
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
    const guild = client.guilds.cache.first();
    if (!guild) return console.error("❌ 서버를 찾을 수 없습니다.");

    const bossAlertChannel = guild.channels.cache.find(channel => channel.name === "보스알림");
    if (!bossAlertChannel) return console.error("❌ '보스알림' 채널을 찾을 수 없습니다.");

        try {
        const savedMessageId = await getSavedMessageId();
        if (savedMessageId) {
            const fetched = await bossAlertChannel.messages.fetch(savedMessageId, { cache: false, force: true });

            if (fetched && fetched.edit) {
                bossMessage = fetched;
                console.log(`✅ 이전 메시지 불러오기 성공: ${fetched.id}`);
            } else {
                console.warn("⚠️ 메시지 불러왔지만 편집 불가능. 새로 만듭니다.");
            }
        }
    } catch (err) {
        console.error("⚠️ 메시지 불러오기 실패:", err.message);
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

        await saveMessageId(bossMessage.id); // ✅ 여기에 저장
    }


    updateBossMessage(bossAlertChannel);
    scheduleBossAlerts(bossAlertChannel);
});

function scheduleBossAlerts(channel) {
    for (let hour = 0; hour < 24; hour++) {
        bossSchedule.forEach(({ hourType, minute, boss }) => {
            if (hourType === '홀수' && hour % 2 === 0) return;
            if (hourType === '짝수' && hour % 2 !== 0) return;

            const scheduleTime = new schedule.RecurrenceRule();
            scheduleTime.hour = hour;
            scheduleTime.minute = minute - 1;

            schedule.scheduleJob(scheduleTime, async () => {
    const role = channel.guild.roles.cache.find(r => r.name === '보스알림');
if (!role) {
    console.warn("⚠️ '보스알림' 역할이 존재하지 않아 알림을 보낼 수 없습니다.");
    return;
}

const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('⚔️ 보스 리스폰 알림 ⚔️')
    .setDescription(`**${hour}시 ${minute}분**\n**${boss}** 보스 리스폰 1분 전!\n\n⚠️ 이 메시지는 60초 후 삭제됩니다.`)
    .setFooter({ text: '준비하세요!' });

try {
    const msg = await channel.send({
        content: `${role}`, // 역할 멘션
        embeds: [embed]
    });

    // 60초 후 삭제
    setTimeout(() => {
        msg.delete().catch(err => console.error("❌ 메시지 삭제 실패:", err.message));
    }, 60 * 1000);
} catch (err) {
    console.error("❌ 보스 알림 메시지 전송 실패:", err.message);
}


    // 옵션: 채널에도 안내 메시지 보낼 수 있음
    //channel.send({ content: `📢 **${boss}** 보스 리젠 1분 전입니다! (이모지 누른 유저에게만 알림 전송됨)` });
});
        });
    }
}


client.login(TOKEN).catch(err => console.error("❌ ERROR: 디스코드 봇 로그인 실패!", err));

