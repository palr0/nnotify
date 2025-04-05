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
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const isOddHour = currentHour % 2 !== 0; // 홀수 시간이면 true, 짝수 시간이면 false

    for (let i = 0; i < bossSchedule.length; i++) {
        let { hourType, minute, boss } = bossSchedule[i];

        // 홀수 시간에는 '홀수' hourType을 가진 보스만, 짝수 시간에는 '짝수' hourType을 가진 보스만 선택
        if ((hourType === '홀수' && !isOddHour) || (hourType === '짝수' && isOddHour)) continue;

        if (currentMinute < minute) {
            currentBossIndex = i;
            return { boss, hour: currentHour, minute };
        }
    }

    // 다음 시간대의 보스 스케줄 찾기
    for (let i = 0; i < bossSchedule.length; i++) {
        let { hourType, minute, boss } = bossSchedule[i];

        const nextHour = isOddHour ? currentHour + 1 : currentHour + 1;
        const isNextHourOdd = nextHour % 2 !== 0;

        if ((hourType === '홀수' && !isNextHourOdd) || (hourType === '짝수' && isNextHourOdd)) continue;

        currentBossIndex = i;
        return { boss, hour: nextHour, minute };
    }

    // 기본적으로 첫 번째 보스를 반환
    return { ...bossSchedule[0], hour: currentHour + 1 };
}


async function getBossAlertRole(guild) {
    return guild.roles.cache.find(role => role.name === "보스알림");
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

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;
    
    const args = message.content.slice(1).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
    
    if (command === '보스추가') {
        if (args.length < 2) return message.reply('사용법: `!보스추가 <이름> <분>`');
        
        const bossName = args[0];
        const minute = parseInt(args[1], 10);
        if (isNaN(minute) || minute < 0 || minute >= 60) {
            return message.reply('올바른 분 값을 입력하세요. (0~59)');
        }
        
        bossSchedule.push({ minute, boss: bossName });
        message.reply(`✅ 보스 \`${bossName}\`가 ${minute}분에 추가되었습니다.`);
    }
    
    if (command === '보스삭제') {
        if (args.length < 1) return message.reply('사용법: `!보스삭제 <이름>`');
        
        const bossName = args[0];
        const index = bossSchedule.findIndex(b => b.boss === bossName);
        
        if (index === -1) {
            return message.reply(`❌ 보스 \`${bossName}\`를 찾을 수 없습니다.`);
        }
        
        bossSchedule.splice(index, 1);
        message.reply(`🗑️ 보스 \`${bossName}\`가 삭제되었습니다.`);
    }
    
    if (command === '보스목록') {
        if (bossSchedule.length === 0) {
            return message.reply('등록된 보스가 없습니다.');
        }
        
        const bossList = bossSchedule.map(b => `- **${b.boss}**: ${b.minute}분`).join('\n');
        message.reply(`📜 현재 보스 목록:\n${bossList}`);
    }
});

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 봇이 온라인입니다!`);
    const guild = client.guilds.cache.first();
    if (!guild) return console.error("❌ 서버를 찾을 수 없습니다.");

    const bossAlertChannel = guild.channels.cache.find(channel => channel.name === "보스알림");
    if (!bossAlertChannel) return console.error("❌ '보스알림' 채널을 찾을 수 없습니다.");

    // 봇이 재시작될 때 최대 1000개의 메시지 삭제
    let deletedMessages = 0;
    while (deletedMessages < 1000) {
        const messages = await bossAlertChannel.messages.fetch({ limit: 100 });
        if (messages.size === 0) break;
        await bossAlertChannel.bulkDelete(messages).catch(console.error);
        deletedMessages += messages.size;
    }

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
