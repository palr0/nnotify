import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import './server.js';

// 환경 변수 로드
dotenv.config();

// 상수 정의
const BOSS_CHANNEL_NAME = '보스알림';
const ALERT_ROLE_NAME = '보스알림';
const BOSS_ALERT_EMOJI = '🔔';
const UPDATE_INTERVAL_MS = 10000; // 10초

// 검증
if (!process.env.TOKEN) throw new Error("TOKEN 환경 변수가 필요합니다.");
if (!process.env.JSONBIN_API_KEY) throw new Error("JSONBIN_API_KEY 환경 변수가 필요합니다.");
if (!process.env.JSONBIN_BIN_ID) throw new Error("JSONBIN_BIN_ID 환경 변수가 필요합니다.");

const bossMessages = new Map();
const alertUsers = new Set();
const updateIntervals = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// 보스 스케줄 정의
const bossSchedule = [
    { minute: 0, boss: '그루트킹' },
    { minute: 30, boss: '해적 선장' },
    { hourType: '홀수', minute: 10, boss: '위더' },
    { hourType: '짝수', minute: 10, boss: '아절 브루트' },
    { hourType: '홀수', minute: 40, boss: '에이트' },
    { hourType: '짝수', minute: 40, boss: '쿵푸' },
    { hourType: '짝수', minute: 50, boss: '세르칸' }
];

const bossLocations = {
    '그루트킹': '1-5 지역',
    '해적 선장': '2-5 지역',
    '아절 브루트': '3-5 지역',
    '위더': '4-5 지역',
    '쿵푸': '5-1 지역',
    '에이트': '6-5 지역',
    '세르칸': '7-5 지역'
};

// 한국 시간 형식으로 변환
// 한국 시간 형식으로 변환 (출력용으로 3시간 뺀 시간 표시)
function getKoreanTime(date = new Date()) {
    const adjustedDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    return adjustedDate.toLocaleString('ko-KR', { 
        timeZone: 'Asia/Seoul',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 다음 보스 목록 가져오기
function getUpcomingBosses(now = new Date()) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const possibleBosses = [];

    // 현재 시간부터 6시간 이내의 보스 검사
    for (let hourOffset = 0; hourOffset <= 6; hourOffset++) {
        const checkHour = (currentHour + hourOffset) % 24;
        const isOddHour = checkHour % 2 !== 0;

        bossSchedule.forEach(({ hourType, minute, boss }) => {
            // 시간 타입 검사 (홀수/짝수 시간)
            if (hourType === '홀수' && !isOddHour) return;
            if (hourType === '짝수' && isOddHour) return;

            // 현재 시간과 같은 시간대의 경우, 이미 지난 분은 건너뜀
            if (hourOffset === 0 && minute <= currentMinute) return;

            const bossDate = new Date(now);
            bossDate.setHours(checkHour, minute, 0, 0);

            // 이미 지난 시간은 다음 날로 설정
            if (bossDate <= now) {
                bossDate.setDate(bossDate.getDate() + 1);
            }

            // 출력용 시간 문자열 생성 (6시간 뺀 시간으로 표시)
            const displayDate = new Date(bossDate.getTime() - 3 * 60 * 60 * 1000);
            const timeStr = `${displayDate.getHours().toString().padStart(2, '0')}:${displayDate.getMinutes().toString().padStart(2, '0')}`;

            possibleBosses.push({
                boss,
                date: bossDate, // 실제 로직에는 원래 시간 사용
                timeStr: timeStr // 출력에는 6시간 뺀 시간 사용
            });
        });
    }

    // 시간 순으로 정렬
    possibleBosses.sort((a, b) => a.date - b.date);
    return possibleBosses;
}

// JSONBin에서 데이터 가져오기
async function getSavedMessageId(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });
        return response.data.record[guildId];
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 메시지 ID 불러오기 실패:`, err.message);
        return null;
    }
}

// JSONBin에 데이터 저장
async function saveMessageId(guildId, messageId) {
    try {
        // 기존 데이터 가져오기
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });

        const updatedRecord = response.data?.record || {};
        updatedRecord[guildId] = messageId;

        // 업데이트된 데이터 저장
        await axios.put(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}`, updatedRecord, {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': process.env.JSONBIN_API_KEY,
                'X-Bin-Versioning': 'false'
            }
        });

        console.log(`[${getKoreanTime()}] ✅ 메시지 ID 저장됨 (${guildId}): ${messageId}`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 메시지 ID 저장 실패:`, err.message);
    }
}

async function updateBossMessage(guildId, channel, initialMessage) {
    // 기존 인터벌 제거
    if (updateIntervals.has(guildId)) {
        clearInterval(updateIntervals.get(guildId));
    }

    // 새 인터벌 설정 (10초마다 실행)
    const intervalId = setInterval(async () => {
        try {
            const now = new Date();
            const bosses = getUpcomingBosses(now);
            if (bosses.length === 0) return;

            const nextBoss = bosses[0];
            const nextNextBoss = bosses[1] || { boss: '없음', timeStr: '-' };

            // 메인 메시지 업데이트
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('보스 알림 받기')
                .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
                .addFields(
                    { name: "📢 다음 보스", value: `**${nextBoss.boss}** (${nextBoss.timeStr})`, inline: false },
                    { name: "⏭️ 그 다음 보스", value: `**${nextNextBoss.boss}** (${nextNextBoss.timeStr})`, inline: false }
                )
                .setFooter({ text: `${BOSS_ALERT_EMOJI} 클릭해서 알림을 받으세요!` });

            const bossMessage = bossMessages.get(guildId);
            if (bossMessage && bossMessage.editable) {
                await bossMessage.edit({ embeds: [embed] });
            }

            // 1분 전 알림 로직 (10초마다 확인)
            const timeUntilBoss = nextBoss.date.getTime() - now.getTime();
            
            if (timeUntilBoss <= 60000 && timeUntilBoss > 0) {
                // 역할 찾기 (채널의 guild에서 찾아야 함)
                const role = channel.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
                if (!role) {
                    console.error(`[${getKoreanTime()}] ❌ ${ALERT_ROLE_NAME} 역할을 찾을 수 없습니다.`);
                    return;
                }

                // 역할 멤버 수 확인
                const membersWithRole = role.members.size;
                if (membersWithRole === 0) {
                    console.log(`[${getKoreanTime()}] ⚠️ ${ALERT_ROLE_NAME} 역할을 가진 멤버가 없어 알림을 보내지 않습니다.`);
                    return;
                }

                // 이미 알림을 보냈는지 확인 (중복 알림 방지)
                if (!bossMessages.has(`${guildId}_alert_${nextBoss.boss}_${nextBoss.timeStr}`)) {
                    const alertEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('⚠️ 보스 알림 ⚠️')
                        .setDescription(`**${nextBoss.boss}**가 1분 후에 출현합니다!`)
                        .addFields(
                            { name: "출현 시간", value: nextBoss.timeStr, inline: true },
                            { name: "위치", value: bossLocations[nextBoss.boss] || "보스 출현 지역", inline: true },
                            { name: "알림", value: "이 알림은 1분 후에 자동으로 삭제됩니다.", inline: false }
                        )
                        .setFooter({ text: `출현 예정 시간: ${nextBoss.timeStr}` });

                    const alertMessage = await channel.send({ 
                        content: `<@&${role.id}>`,
                        embeds: [alertEmbed],
                        allowedMentions: { roles: [role.id] }
                    });
                    
                    console.log(`[${getKoreanTime()}] 🔔 1분 전 알림 전송: ${nextBoss.boss} (${membersWithRole}명에게 전송)`);
                    
                    // 중복 알림 방지를 위해 표시
                    bossMessages.set(`${guildId}_alert_${nextBoss.boss}_${nextBoss.timeStr}`, true);

                    // 1분 후에 알림 메시지 삭제
                    setTimeout(() => {
                        alertMessage.delete().catch(console.error);
                        console.log(`[${getKoreanTime()}] 🗑️ 보스 알림 메시지 삭제: ${nextBoss.boss}`);
                        // 중복 알림 방지 플래그 제거
                        bossMessages.delete(`${guildId}_alert_${nextBoss.boss}_${nextBoss.timeStr}`);
                    }, 60000);
                }
            }
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ 보스 메시지 업데이트 실패:`, err.message);
        }
    }, UPDATE_INTERVAL_MS); // 10초마다 실행

    updateIntervals.set(guildId, intervalId);
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // 봇 메시지 무시

    // (변경) 명령어가 아닌 경우 무시 (/로 시작하지 않으면 아무런 응답 X)
    if (!message.content.startsWith('/')) return;

    // (변경) 명령어인 경우에만 채널 검사 수행
    if (message.channel.name !== BOSS_CHANNEL_NAME) {
        const reply = await message.channel.send("⚠️ 이 명령어는 #보스알림 채널에서만 사용 가능합니다.");
        setTimeout(() => reply.delete(), 3000);
        return;
    }
        
    try {
        // 한국 시간 표시
        if (message.content.startsWith('/시간 한국표준')) {
            const koreanTime = getKoreanTime();
            const reply = await message.channel.send(`현재 한국 표준시(KST)는: ${koreanTime}\n\n이 메시지는 1분 후에 자동으로 삭제됩니다.`);
            setTimeout(() => {
                reply.delete().catch(console.error);
                console.log(`[${getKoreanTime()}] 메시지 삭제: ${reply.id}`);
            }, 60000);
            return;
        }

        // 보스 순서 표시
        if (message.content.startsWith('/보스 순서')) {
            const bosses = getUpcomingBosses();
            const description = bosses.slice(0, 5).map(b => `**${b.boss}** - ${b.timeStr}`).join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🕒 앞으로 등장할 보스 순서 (최대 5개)')
                .setDescription(description || '예정된 보스가 없습니다.')
                .setFooter({ text: '이 메시지는 1분 후에 자동으로 삭제됩니다.' });

            const reply = await message.channel.send({ embeds: [embed] });
            setTimeout(() => {
                reply.delete().catch(console.error);
                console.log(`[${getKoreanTime()}] 메시지 삭제: ${reply.id}`);
            }, 60000);
            return;
        }

        // 도움말
        if (message.content.startsWith('/도움말')) {
            const embed = new EmbedBuilder()
                .setColor(0x7289DA)
                .setTitle('📝 명령어 도움말')
                .addFields(
                    { name: '/시간 한국표준', value: '현재 한국 시간을 표시합니다.' },
                    { name: '/보스 순서', value: '다가오는 보스 출현 순서를 표시합니다.' },
                    { name: '/도움말', value: '이 도움말을 표시합니다.' }
                )
                .setFooter({ text: '이 메시지는 1분 후에 자동으로 삭제됩니다.' });

            const reply = await message.channel.send({ embeds: [embed] });
            setTimeout(() => {
                reply.delete().catch(console.error);
                console.log(`[${getKoreanTime()}] 메시지 삭제: ${reply.id}`);
            }, 60000);
            return;
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 명령어 처리 오류:`, err.message);
        const errorMsg = await message.channel.send('명령어 처리 중 오류가 발생했습니다.\n\n이 메시지는 1분 후에 자동으로 삭제됩니다.');
        setTimeout(() => {
            errorMsg.delete().catch(console.error);
            console.log(`[${getKoreanTime()}] 메시지 삭제: ${errorMsg.id}`);
        }, 60000);
    }
});

// 반응 추가 처리
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== BOSS_ALERT_EMOJI) return;

    try {
        const guildId = reaction.message.guild.id;
        const targetMessage = bossMessages.get(guildId);
        
        if (!targetMessage || reaction.message.id !== targetMessage.id) return;

        alertUsers.add(user.id);
        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);

        // 역할 생성 또는 확인
        let role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
        if (!role) {
            role = await guild.roles.create({
                name: ALERT_ROLE_NAME,
                mentionable: true,
                reason: '보스 알림을 위한 역할 자동 생성'
            });
        }

        // 역할 부여
        await member.roles.add(role);
        console.log(`[${getKoreanTime()}] ✅ ${user.tag} 알림 등록 및 역할 부여`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 반응 추가 처리 오류:`, err.message);
    }
});

// 반응 제거 처리
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== BOSS_ALERT_EMOJI) return;

    try {
        const guildId = reaction.message.guild.id;
        const targetMessage = bossMessages.get(guildId);
        
        if (!targetMessage || reaction.message.id !== targetMessage.id) return;

        alertUsers.delete(user.id);
        const guild = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);

        if (role) {
            await member.roles.remove(role);
            console.log(`[${getKoreanTime()}] 🔕 ${user.tag} 알림 해제 및 역할 제거`);
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 반응 제거 처리 오류:`, err.message);
    }
});

// 봇 준비 완료 시
client.once('ready', async () => {
    console.log(`[${getKoreanTime()}] ✅ ${client.user.tag} 봇이 온라인입니다!`);

    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const bossAlertChannel = guild.channels.cache.find(c => 
                c.name === BOSS_CHANNEL_NAME && 
                c.type === 0 && // 텍스트 채널
                c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
            );

            if (!bossAlertChannel) {
                console.error(`[${getKoreanTime()}] ❌ '${guild.name}' 서버에서 '${BOSS_CHANNEL_NAME}' 채널을 찾을 수 없거나 권한이 없습니다.`);
                continue;
            }

            let bossMessage = null;
            const savedMessageId = await getSavedMessageId(guildId);

            // 저장된 메시지 불러오기 시도
            if (savedMessageId) {
                try {
                    bossMessage = await bossAlertChannel.messages.fetch(savedMessageId);
                    bossMessages.set(guildId, bossMessage);
                    console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버 이전 메시지 불러오기 성공: ${bossMessage.id}`);
                } catch (fetchErr) {
                    console.error(`[${getKoreanTime()}] ⚠️ ${guild.name} 서버에서 메시지 불러오기 실패:`, fetchErr.message);
                }
            }

            // 새 메시지 생성
            if (!bossMessage) {
                const embed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle('보스 알림 받기')
                    .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
                    .addFields({ name: "📢 다음 보스", value: `불러오는 중...` })
                    .setFooter({ text: `${BOSS_ALERT_EMOJI} 클릭해서 알림을 받으세요!` });

                bossMessage = await bossAlertChannel.send({ embeds: [embed] });
                await bossMessage.react(BOSS_ALERT_EMOJI);
                bossMessages.set(guildId, bossMessage);
                await saveMessageId(guildId, bossMessage.id);
                console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버에 새 메시지 생성: ${bossMessage.id}`);
            }

            // 메시지 업데이트 시작
            updateBossMessage(guildId, bossAlertChannel, bossMessage);
        } catch (guildErr) {
            console.error(`[${getKoreanTime()}] ❌ ${guild.name} 서버 초기화 실패:`, guildErr.message);
        }
    }
});

// 봇 로그인
client.login(process.env.TOKEN).catch(err => {
    console.error(`[${getKoreanTime()}] ❌ 봇 로그인 실패:`, err.message);
    process.exit(1);
});

// 종료 시 정리
process.on('SIGINT', () => {
    console.log(`[${getKoreanTime()}] 🔴 봇 종료 중...`);
    client.destroy();
    process.exit();
});
