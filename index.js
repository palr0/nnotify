const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const config = require('./config.env');
const server = require('./server.js');
const axios = require('axios');
require('dotenv').config({ path: './config.env' });
const TOKEN = process.env.TOKEN;
const bossMessages = new Map(); // key: guild.id, value: message
//const fetched = await bossAlertChannel.messages.fetch(savedMessageId, { cache: false, force: true });
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
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    const candidates = [];

    for (let offset = 0; offset <= 2; offset++) {
        const checkHour = now.getHours() + offset;

        bossSchedule.forEach(({ hourType, minute, boss }) => {
            if (hourType === '홀수' && checkHour % 2 === 0) return;
            if (hourType === '짝수' && checkHour % 2 !== 0) return;

            const totalMinutes = checkHour * 60 + minute;
            if (totalMinutes > currentTotalMinutes) {
                candidates.push({ boss, hour: checkHour, minute, totalMinutes });
            }
        });
    }

    // 가장 가까운 시간을 가진 보스 선택
    if (candidates.length > 0) {
        candidates.sort((a, b) => a.totalMinutes - b.totalMinutes);
        const { boss, hour, minute } = candidates[0];
        return { boss, hour, minute };
    }

    return { boss: '알 수 없음', hour: now.getHours(), minute: now.getMinutes() };
}



async function getSavedMessageId(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}/latest`, {
            headers: {
                'X-Master-Key': config.JSONBIN_API_KEY
            }
        });
        return response.data.record[guildId]; // 서버 ID 기준으로 저장된 메시지 ID 반환
    } catch (err) {
        console.error("❌ 메시지 ID 불러오기 실패:", err.message);
        return null;
    }
}

async function saveMessageId(guildId, messageId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}/latest`, {
            headers: {
                'X-Master-Key': config.JSONBIN_API_KEY
            }
        });

        const updatedRecord = response.data.record || {};
        updatedRecord[guildId] = messageId;

        await axios.put(`https://api.jsonbin.io/v3/b/${config.JSONBIN_BIN_ID}`, 
                        { record: updatedRecord }, 
                        {
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
    bossMessages.set(guildId, initialMessage); // 메시지 저장

    setInterval(async () => {
        const now = new Date();
        const { boss, hour, minute } = getNextBoss();

        let remainingMinutes = minute - now.getMinutes();
        let remainingSeconds = 60 - now.getSeconds();

        if (remainingSeconds === 60) {
            remainingMinutes++;
            remainingSeconds = 0;
        }

        if (remainingMinutes < 0 || (remainingMinutes === 0 && remainingSeconds <= 0)) return;

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('보스 알림 받기')
            .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
            .addFields({
                name: "📢 다음 보스",
                value: `**${boss}** 남은 시간: **${remainingMinutes}분 ${remainingSeconds}초**`
            })
            .setFooter({ text: '🔔 클릭해서 알림을 받으세요!' });

        const bossMessage = bossMessages.get(guildId);

        if (bossMessage) {
            await bossMessage.edit({ embeds: [embed] }).catch(console.error);
        }
    }, 5000); // 5초마다 업데이트
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
                } else {
                    console.warn(`⚠️ ${guild.name} 서버에서 메시지를 불러왔지만 편집 불가능. 새로 만듭니다.`);
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

            await saveMessageId(guild.id, bossMessage.id);
            bossMessages.set(guild.id, bossMessage);
        }

        updateBossMessage(bossAlertChannel, bossMessage); // 호출 시 메시지도 전달
        scheduleBossAlerts(bossAlertChannel);
    });
});


function scheduleBossAlerts(channel) {
    for (let hour = 0; hour < 24; hour++) {
        bossSchedule.forEach(({ hourType, minute, boss }) => {
            if (hourType === '홀수' && hour % 2 === 0) return;
            if (hourType === '짝수' && hour % 2 !== 0) return;

            const scheduleTime = new schedule.RecurrenceRule();
            scheduleTime.tz = 'Asia/Seoul'; // 한국 시간대 설정
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
