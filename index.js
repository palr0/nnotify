const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const config = require('./config.env');
const server = require('./server.js');
const fs = require('fs');
const { Message } = require('discord.js'); // 메시지 타입 체크용
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

    alertUsers.add(user.id); // 이모지 누른 유저 저장
    console.log(`✅ ${user.tag} 알림 등록됨`);
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (reaction.message.id !== bossMessage?.id) return;
    if (reaction.emoji.name !== '🔔') return;
    if (user.bot) return;

    alertUsers.delete(user.id);
    console.log(`🔕 ${user.tag} 알림 해제됨`);
});


client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 봇이 온라인입니다!`);
    const guild = client.guilds.cache.first();
    if (!guild) return console.error("❌ 서버를 찾을 수 없습니다.");

    const bossAlertChannel = guild.channels.cache.find(channel => channel.name === "보스알림");
    if (!bossAlertChannel) return console.error("❌ '보스알림' 채널을 찾을 수 없습니다.");

    try {
        if (fs.existsSync(path)) {
            const savedMessageId = fs.readFileSync(path, 'utf8').trim();
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
        fs.writeFileSync(path, bossMessage.id);
        console.log(`🆕 새 메시지 생성 및 저장: ${bossMessage.id}`);
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
    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('⚔️ 보스 리스폰 알림 ⚔️')
        .setDescription(`**${hour}시 ${minute}분**\n**${boss}** 보스 리스폰 1분 전!`)
        .setFooter({ text: '준비하세요!' });

    for (const userId of alertUsers) {
        try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [embed] });
        } catch (err) {
            console.error(`❌ ${userId}에게 DM 전송 실패:`, err.message);
        }
    }

    // 옵션: 채널에도 안내 메시지 보낼 수 있음
    channel.send({ content: `📢 **${boss}** 보스 리젠 1분 전입니다! (이모지 누른 유저에게만 알림 전송됨)` });
});
        });
    }
}


client.login(TOKEN).catch(err => console.error("❌ ERROR: 디스코드 봇 로그인 실패!", err));

