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
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    const candidates = [];

    for (let offset = 0; offset <= 2; offset++) {
        const checkHour = currentHour + offset;

        bossSchedule.forEach(({ hourType, minute, boss }) => {
            const isCheckHourOdd = checkHour % 2 !== 0;

            // ✅ checkHour의 홀짝 조건에 맞게 필터링
            if (hourType === '홀수' && !isCheckHourOdd) return;
            if (hourType === '짝수' && isCheckHourOdd) return;

            // ❗ offset이 0일 때, 이미 지난 시간은 제외
            if (offset === 0 && minute <= currentMinute) return;

            const totalMinutes = checkHour * 60 + minute;
            candidates.push({ boss, hour: checkHour, minute, totalMinutes });
        });
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => a.totalMinutes - b.totalMinutes);
        const { boss, hour, minute } = candidates[0];
        return { boss, hour, minute };
    }

    return { boss: '알 수 없음', hour: currentHour, minute: currentMinute };
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
    const guildId = channel.guild?.id || channel.guildId;
    bossMessages.set(guildId, initialMessage); // 초기 메시지 저장

    setInterval(async () => {
        const now = new Date();
        const { boss, hour, minute } = getNextBoss();

        let remainingMinutes = minute - now.getMinutes();
        let remainingSeconds = 60 - now.getSeconds();

        if (remainingSeconds === 60) {
            remainingMinutes++;
            remainingSeconds = 0;
        }

        if (remainingMinutes < 0 || (remainingMinutes === 0 && remainingSeconds <= 0)) {
            return; // 이미 지난 보스 시간은 무시
        }

        remainingMinutes = Math.max(0, remainingMinutes - 1); // 1분 미리 알림

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('보스 알림 받기')
            .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
            .addFields({ name: "📢 다음 보스", value: `${boss} - ${hour}시 ${minute}분 (약 ${remainingMinutes}분 ${remainingSeconds}초 남음)` })
            .setFooter({ text: '🔔 클릭해서 알림을 받으세요!' });

        let bossMessage = bossMessages.get(guildId);

        // 메시지가 없거나 편집 불가능할 경우 새로 생성
        if (!bossMessage || typeof bossMessage.edit !== 'function') {
            try {
                bossMessage = await channel.send({ embeds: [embed] });
                await bossMessage.react('🔔');
                await saveMessageId(guildId, bossMessage.id);
                bossMessages.set(guildId, bossMessage);
                console.log(`🆕 ${channel.guild?.name || guildId}에 새 보스 메시지 생성됨`);
            } catch (err) {
                console.error(`❌ 메시지 생성 실패:`, err.stack || err.message);
                return;
            }
        } else {
            // 메시지 업데이트
            try {
                await bossMessage.edit({ embeds: [embed] });
            } catch (err) {
                console.error(`⚠️ 메시지 업데이트 실패:`, err.stack || err.message);
            }
        }
    }, 5000); // 5초 간격으로 업데이트
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

        let retryCount = 0;
        const maxRetries = 3;
        let fetched = null;

        while (retryCount < maxRetries && !fetched) {
            try {
                const savedMessageId = await getSavedMessageId(guild.id);
                if (!savedMessageId) throw new Error("저장된 메시지 ID가 없습니다.");

                fetched = await bossAlertChannel.messages.fetch(savedMessageId, { cache: false, force: true });

                if (!fetched || typeof fetched.edit !== 'function') {
                    throw new Error("메시지를 불러왔지만 편집이 불가능합니다.");
                }

                bossMessage = fetched;
                bossMessages.set(guild.id, bossMessage);
                console.log(`✅ ${guild.name} 서버 메시지 불러오기 성공: ${fetched.id}`);
            } catch (err) {
                retryCount++;
                console.warn(`⚠️ ${guild.name} 서버 메시지 불러오기 실패 (시도 ${retryCount}/${maxRetries}):`, err.stack || err.message);
                await new Promise(res => setTimeout(res, 2000)); // 2초 대기 후 재시도
            }
        }

        // 메시지 fetch에 실패한 경우 새로 메시지를 생성
        if (!bossMessage) {
            try {
                const newMessage = await bossAlertChannel.send('보스 알림 메시지를 초기화합니다.');
                bossMessages.set(guild.id, newMessage);
                await saveMessageId(guild.id, newMessage.id);
                console.log(`🆕 ${guild.name} 서버에 새 메시지를 생성하고 저장했습니다: ${newMessage.id}`);
            } catch (creationError) {
                console.error(`❌ ${guild.name} 서버에서 새 메시지를 생성하는 데 실패했습니다:`, creationError.stack || creationError.message);
            }
        }
        await updateBossMessage(bossAlertChannel, bossMessage); // 보스 메시지 업데이트 주기 설정
scheduleBossAlerts(bossAlertChannel); // 🔔 보스 알림 스케줄 등록
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
