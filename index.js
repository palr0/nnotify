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

// 이모지 등록자 확인 및 알림 전송 함수 추가
async function checkEmojiReactionsAndNotify(guild) {
    try {
        const guildId = guild.id;
        const targetMessage = bossMessages.get(guildId);
        if (!targetMessage) return;

        // 채널 확인
        const channel = targetMessage.channel;
        if (!channel) return;

        // 역할 확인
        const role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
        if (!role) return;

        // 이모지 반응 가져오기
        const reactions = targetMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
        if (!reactions) return;

        // 반응한 사용자 목록 가져오기
        const users = await reactions.users.fetch();
        const reactingUserIds = new Set(users.filter(u => !u.bot).map(u => u.id));

        // 역할을 가진 모든 멤버 가져오기
        const membersWithRole = role.members;

        // 1. 역할은 있지만 이모지를 누르지 않은 멤버에서 역할 제거
        for (const [memberId, member] of membersWithRole) {
            if (!reactingUserIds.has(memberId)) {
                await member.roles.remove(role).catch(console.error);
                console.log(`[${getKoreanTime()}] 🔄 ${member.user.tag} 사용자가 이모지를 누르지 않았지만 역할이 남아있어 제거했습니다.`);
            }
        }

        // 2. 이모지를 눌렀지만 역할이 없는 멤버에게 역할 부여
        for (const userId of reactingUserIds) {
            try {
                const member = await guild.members.fetch(userId);
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role);
                    console.log(`[${getKoreanTime()}] ✅ ${member.user.tag} 사용자에게 알림 역할 부여 (이모지 등록 확인)`);
                }
            } catch (err) {
                console.error(`[${getKoreanTime()}] ❌ ${userId} 사용자 역할 부여 실패:`, err.message);
            }
        }

        // 3. 다음 보스 알림을 위해 등록된 사용자 목록 업데이트
        alertUsers.clear();
        for (const userId of reactingUserIds) {
            alertUsers.add(userId);
        }

        console.log(`[${getKoreanTime()}] 🔍 ${guild.name} 서버 이모지 상태 확인 완료: ${reactingUserIds.size}명 등록`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 이모지 상태 확인 실패:`, err.message);
    }
}

// 기존 updateBossMessage 함수 수정
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

            // 매번 업데이트 시 이모지 상태 확인
            await checkEmojiReactionsAndNotify(channel.guild);

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
                    // 등록된 사용자만 멘션하기 위해 사용자 ID 목록 생성
                    const mentions = Array.from(alertUsers).map(id => `<@${id}>`).join(' ');

                    const alertEmbed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('⚠️ 보스 알림 ⚠️')
                        .setDescription(`**${nextBoss.boss}**가 ${bossLocations[nextBoss.boss]}에 1분 후 출현합니다!`)
                        .addFields(
                            { name: "출현 시간", value: nextBoss.timeStr, inline: true },
                            { name: "알림", value: "이 알림은 1분 후에 자동으로 삭제됩니다.", inline: false }
                        )
                        .setFooter({ text: `출현 예정 시간: ${nextBoss.timeStr}` });

                    const alertMessage = await channel.send({ 
                        content: `**${nextBoss.boss}**가 ${bossLocations[nextBoss.boss]}에 1분 후 출현합니다! ${mentions}`,
                        embeds: [alertEmbed],
                        allowedMentions: { users: Array.from(alertUsers) }
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

    // 명령어가 아닌 경우 무시 (/로 시작하지 않으면 아무런 응답 X)
    if (!message.content.startsWith('/')) return;

    // 명령어인 경우에만 채널 검사 수행
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

// 기존 코드는 동일하므로 변경된 부분만 표시합니다.

// 반응 추가 처리 (변경된 부분)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== BOSS_ALERT_EMOJI) return;

    try {
        const guildId = reaction.message.guild.id;
        const targetMessage = bossMessages.get(guildId);
        
        if (!targetMessage || reaction.message.id !== targetMessage.id) return;

        // 사용자 캐시에서 가져오기 시도
        let member = reaction.message.guild.members.cache.get(user.id);
        
        // 캐시에 없으면 API 요청
        if (!member) {
            member = await reaction.message.guild.members.fetch(user.id);
        }

        // 역할 생성 또는 확인
        let role = reaction.message.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
        if (!role) {
            role = await reaction.message.guild.roles.create({
                name: ALERT_ROLE_NAME,
                mentionable: true,
                reason: '보스 알림을 위한 역할 자동 생성'
            });
        }

        // 역할 부여
        await member.roles.add(role);
        alertUsers.add(user.id);
        
        console.log(`[${getKoreanTime()}] ✅ ${user.tag} 알림 등록 및 역할 부여`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 반응 추가 처리 오류:`, err.message);
    }
});

// 반응 제거 처리 (변경된 부분)
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== BOSS_ALERT_EMOJI) return;

    try {
        const guildId = reaction.message.guild.id;
        const targetMessage = bossMessages.get(guildId);
        
        if (!targetMessage || reaction.message.id !== targetMessage.id) return;

        // 사용자 캐시에서 가져오기 시도
        let member = reaction.message.guild.members.cache.get(user.id);
        
        // 캐시에 없으면 API 요청
        if (!member) {
            member = await reaction.message.guild.members.fetch(user.id);
        }

        const role = reaction.message.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);

        if (role) {
            // 사용자가 여전히 역할을 가지고 있는지 확인
            if (member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                alertUsers.delete(user.id);
                console.log(`[${getKoreanTime()}] 🔕 ${user.tag} 알림 해제 및 역할 제거`);
                
                // 추가로, 이모지가 눌려져 있지 않은데 역할이 남아있는 경우를 확인
                const reactions = targetMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
                if (reactions) {
                    const users = await reactions.users.fetch();
                    if (!users.has(user.id)) {
                        await member.roles.remove(role).catch(console.error);
                        console.log(`[${getKoreanTime()}] 🔄 ${user.tag} 사용자가 이모지를 누르지 않았지만 역할이 남아있어 제거했습니다.`);
                    }
                }
            }
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 반응 제거 처리 오류:`, err.message);
    }
});

// ... (기존 코드는 동일하게 유지)

// 봇 준비 완료 시 (변경된 부분)
client.once('ready', async () => {
    console.log(`[${getKoreanTime()}] ✅ ${client.user.tag} 봇이 온라인입니다!`);
    console.log(`[${getKoreanTime()}] 🟢 봇 시작 - ${new Date().toISOString()}`);
// 기존 인터벌 정리
    updateIntervals.forEach(interval => clearInterval(interval));
    updateIntervals.clear();

    for (const [guildId, guild] of client.guilds.cache) {
        try {
            // 1. 역할 초기화 및 생성
            let role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
            if (!role) {
                role = await guild.roles.create({
                    name: ALERT_ROLE_NAME,
                    mentionable: true,
                    reason: '보스 알림을 위한 역할 자동 생성'
                });
                console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버에 ${ALERT_ROLE_NAME} 역할 생성 완료`);
            } else {
                // 기존 역할이 있는 경우 모든 멤버에서 역할 제거 (초기화)
                const membersWithRole = role.members;
                if (membersWithRole.size > 0) {
                    const removePromises = membersWithRole.map(member => 
                        member.roles.remove(role).catch(console.error)
                    );
                    await Promise.all(removePromises);
                    console.log(`[${getKoreanTime()}] 🔄 ${guild.name} 서버의 기존 ${ALERT_ROLE_NAME} 역할 보유자 ${membersWithRole.size}명에서 역할 제거 완료`);
                }
            }

            // 2. 채널 찾기
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

            // 3. 저장된 메시지 불러오기 시도
            if (savedMessageId) {
                try {
                    bossMessage = await bossAlertChannel.messages.fetch(savedMessageId);
                    
                    // 기존 반응 수집 및 역할 자동 부여
                    const reactions = bossMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
                    if (reactions) {
                        const users = await reactions.users.fetch();
                        
                        // 등록된 사용자에게 역할 부여
                        const addRolePromises = [];
                        for (const [userId, user] of users) {
                            if (!user.bot) {
                                try {
                                    const member = await guild.members.fetch(userId);
                                    addRolePromises.push(
                                        member.roles.add(role).then(() => {
                                            alertUsers.add(userId);
                                            console.log(`[${getKoreanTime()}] ✅ ${user.tag} 기존 알림 등록자 역할 자동 부여`);
                                        })
                                    );
                                } catch (err) {
                                    console.error(`[${getKoreanTime()}] ❌ ${user.tag} 역할 부여 실패:`, err.message);
                                }
                            }
                        }
                        await Promise.all(addRolePromises);
                    }
                    
                    bossMessages.set(guildId, bossMessage);
                    console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버 이전 메시지 불러오기 성공: ${bossMessage.id}`);
                } catch (fetchErr) {
                    console.error(`[${getKoreanTime()}] ⚠️ ${guild.name} 서버에서 메시지 불러오기 실패:`, fetchErr.message);
                }
            }

            // 4. 새 메시지 생성 (기존 메시지가 없는 경우)
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

            // 5. 메시지 업데이트 시작
            updateBossMessage(guildId, bossAlertChannel, bossMessage);
        } catch (guildErr) {
            console.error(`[${getKoreanTime()}] ❌ ${guild.name} 서버 초기화 실패:`, guildErr.message);
        }
    }
});

// 역할 동기화 함수
async function syncRolesWithReactions(guild) {
    try {
        const role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
        if (!role) return;

        const channel = guild.channels.cache.find(c => c.name === BOSS_CHANNEL_NAME);
        if (!channel) return;

        const guildId = guild.id;
        const targetMessage = bossMessages.get(guildId);
        if (!targetMessage) return;

        const reactions = targetMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
        if (!reactions) return;

        const users = await reactions.users.fetch();
        const reactingUserIds = new Set(users.filter(u => !u.bot).map(u => u.id));

        const membersWithRole = role.members;

        for (const [memberId, member] of membersWithRole) {
            if (!reactingUserIds.has(memberId)) {
                await member.roles.remove(role).catch(console.error);
                console.log(`[${getKoreanTime()}] 🔄 ${member.user.tag} 사용자가 이모지를 누르지 않았지만 역할이 남아있어 제거했습니다.`);
            }
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 역할 동기화 실패:`, err.message);
    }
}

// 상태 모니터링 및 주기적 동기화
setInterval(() => {
    console.log(`[${getKoreanTime()}] ℹ️ 봇 상태: 
        ${client.guilds.cache.size} 서버, 
        ${client.ws.ping}ms 핑, 
        ${process.memoryUsage().rss / 1024 / 1024}MB 메모리 사용`);

    client.guilds.cache.forEach(guild => {
        syncRolesWithReactions(guild).catch(console.error);
    });
}, 3600000); // 1시간마다 실행

// 봇 로그인
client.login(process.env.TOKEN).catch(err => {
    console.error(`[${getKoreanTime()}] ❌ 봇 로그인 실패:`, err.message);
    process.exit(1);
});

// 종료 핸들러
function cleanup() {
    console.log(`[${getKoreanTime()}] 🔴 봇 종료 중...`);
    
    // 모든 인터벌 정리
    updateIntervals.forEach(interval => clearInterval(interval));
    updateIntervals.clear();
    
    // 봇 연결 종료
    client.destroy();
    process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (err) => {
    console.error(`[${getKoreanTime()}] ❌ 처리되지 않은 예외:`, err);
    cleanup();
});
