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
const UPDATE_INTERVAL_MS = 60000; // 1분

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
    { hourType: '홀수', minute: 10, boss: '아절 브루트' },
    { hourType: '짝수', minute: 10, boss: '위더' },
    { hourType: '홀수', minute: 40, boss: '쿵푸' },
    { hourType: '짝수', minute: 40, boss: '에이트' },
    { hourType: '홀수', minute: 50, boss: '세르칸' }
];

// 한국 시간 형식으로 변환
function getKoreanTime(date = new Date()) {
    return date.toLocaleString('ko-KR', { 
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
    // 현재 시간에서 3시간을 뺀 시간을 기준으로 계산
    const adjustedNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const currentHour = adjustedNow.getHours();
    const currentMinute = adjustedNow.getMinutes();
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

            const bossDate = new Date(adjustedNow);
            bossDate.setHours(checkHour, minute, 0, 0);

            // 이미 지난 시간은 다음 날로 설정
            if (bossDate <= adjustedNow) {
                bossDate.setDate(bossDate.getDate() + 1);
            }

            // 실제 시간으로 보정 (3시간 더하기)
            const realBossDate = new Date(bossDate.getTime() + 3 * 60 * 60 * 1000);

            possibleBosses.push({
                boss,
                date: realBossDate,
                timeStr: `${realBossDate.getHours().toString().padStart(2, '0')}:${realBossDate.getMinutes().toString().padStart(2, '0')}`
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

// 보스 메시지 업데이트
async function updateBossMessage(guildId, channel, initialMessage) {
    // 기존 인터벌 제거
    if (updateIntervals.has(guildId)) {
        clearInterval(updateIntervals.get(guildId));
    }

    // 새 인터벌 설정
    const intervalId = setInterval(async () => {
        try {
            const bosses = getUpcomingBosses();
            if (bosses.length === 0) return;

            const nextBoss = bosses[0];
            const nextNextBoss = bosses[1] || { boss: '없음', timeStr: '-' };

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

            // 1분 전 알림 로직
            const now = new Date();
            const timeUntilBoss = nextBoss.date.getTime() - now.getTime();
            
            if (timeUntilBoss <= 60000 && timeUntilBoss > 0) {
                const alertEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('⚠️ 보스 알림 ⚠️')
                    .setDescription(`**${nextBoss.boss}**가 1분 후에 출현합니다!`)
                    .addFields(
                        { name: "출현 시간", value: nextBoss.timeStr, inline: true },
                        { name: "위치", value: "보스 출현 지역", inline: true }
                    );

                channel.send({ 
                    content: `@${ALERT_ROLE_NAME}`, 
                    embeds: [alertEmbed] 
                });
            }
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ 보스 메시지 업데이트 실패:`, err.message);
        }
    }, UPDATE_INTERVAL_MS);

    updateIntervals.set(guildId, intervalId);
}

// 명령어 처리
// ... (기존 코드는 동일하며, messageCreate 이벤트 핸들러 부분만 수정합니다)

// 명령어 처리
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // DM 처리 (보스알림 채널로 전송)
    if (message.channel.type === 'DM') {
        try {
            // 사용자가 속한 모든 서버에서 보스알림 채널 찾기
            const guildsWithBossChannel = [];
            
            for (const [guildId, guild] of client.guilds.cache) {
                const bossChannel = guild.channels.cache.find(c => 
                    c.name === BOSS_CHANNEL_NAME && 
                    c.type === 0 && // 텍스트 채널
                    c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
                );
                
                if (bossChannel && guild.members.cache.has(message.author.id)) {
                    guildsWithBossChannel.push({
                        guild,
                        channel: bossChannel
                    });
                }
            }
            
            if (guildsWithBossChannel.length === 0) {
                return message.author.send("⚠️ 연결된 보스알림 채널을 찾을 수 없습니다.");
            }
            
            // 첫 번째 서버의 보스알림 채널에 메시지 전송
            const { channel } = guildsWithBossChannel[0];
            const reply = await channel.send({
                content: `📩 ${message.author.tag}님의 DM: ${message.content}`,
                allowedMentions: { parse: [] }
            });
            
            // 1분 후 삭제
            setTimeout(() => {
                reply.delete().catch(console.error);
            }, 60000);
            
            // 사용자에게 확인 메시지 전송
            await message.author.send(`✅ 메시지가 ${channel.guild.name} 서버의 #${BOSS_CHANNEL_NAME} 채널로 전송되었습니다.`);
            
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ DM 처리 오류:`, err.message);
            message.author.send("⚠️ 메시지 전송 중 오류가 발생했습니다.").catch(console.error);
        }
        return;
    }
    
    // 보스알림 채널에서만 명령어 허용
    if (message.channel.name !== BOSS_CHANNEL_NAME) {
        const reply = await message.channel.send("⚠️ 이 명령어는 #보스알림 채널에서만 사용 가능합니다.");
        setTimeout(() => reply.delete(), 3000); // 3초 후 삭제
        return;
    }
    
    try {
        // 한국 시간 표시
        if (message.content.startsWith('/시간 한국표준')) {
            const koreanTime = getKoreanTime();
            const reply = await message.channel.send(`현재 한국 표준시(KST)는: ${koreanTime}\n\n이 메시지는 1분 후에 사라집니다.`);
            setTimeout(() => reply.delete().catch(console.error), 60000);
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
                .setFooter({ text: '이 메시지는 1분 후에 사라집니다.' });

            const reply = await message.channel.send({ embeds: [embed] });
            setTimeout(() => reply.delete().catch(console.error), 60000);
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
                .setFooter({ text: '이 메시지는 1분 후에 사라집니다.' });

            const reply = await message.channel.send({ embeds: [embed] });
            setTimeout(() => reply.delete().catch(console.error), 60000);
            return;
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 명령어 처리 오류:`, err.message);
        const errorMsg = await message.channel.send('명령어 처리 중 오류가 발생했습니다.\n\n이 메시지는 1분 후에 사라집니다.');
        setTimeout(() => errorMsg.delete().catch(console.error), 60000);
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

        // 사용자에게 DM으로 알림
        try {
            await user.send(`보스 알림이 활성화되었습니다! ${guild.name} 서버에서 보스가 출현하기 1분 전에 알림을 받게 됩니다.`);
        } catch (dmErr) {
            console.log(`[${getKoreanTime()}] ⚠️ ${user.tag}에게 DM 전송 실패:`, dmErr.message);
        }
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
