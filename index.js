const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const schedule = require('node-schedule');
const config = require('./config.env');
const server = require('./server.js'); // express 서버 실행

const TOKEN = config.TOKEN;

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

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 봇이 온라인입니다!`);
    const guild = client.guilds.cache.first();
    if (!guild) return console.error("❌ 서버를 찾을 수 없습니다.");

    const bossAlertChannel = guild.channels.cache.find(channel => channel.name === "보스알림");
    if (!bossAlertChannel) return console.error("❌ '보스알림' 채널을 찾을 수 없습니다.");

    updateBossMessage(bossAlertChannel);
    scheduleBossAlerts(bossAlertChannel);
});

function scheduleBossAlerts(channel) {
    bossSchedule.forEach(({ hourType, minute, boss }) => {
        schedule.scheduleJob({ minute: minute - 1 }, async () => {
            const now = new Date();
            const hour = now.getHours();
            const guild = channel.guild;
            const bossAlertRole = await getBossAlertRole(guild);

            if (hourType === '홀수' && hour % 2 === 0) return;
            if (hourType === '짝수' && hour % 2 !== 0) return;

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚔️ 보스 리스폰 알림 ⚔️')
                .setDescription(`**${hour}시 ${minute}분**\n**${boss}** 보스 리스폰 1분 전!`)
                .setFooter({ text: '준비하세요!' });

            const mentionRole = bossAlertRole ? `<@&${bossAlertRole.id}>` : '';
            channel.send({ content: `${mentionRole} 🚨 **${boss}** 보스가 곧 리스폰됩니다!`, embeds: [embed] });
        });
    });
}

client.login(TOKEN).catch(err => console.error("❌ ERROR: 디스코드 봇 로그인 실패!", err));

