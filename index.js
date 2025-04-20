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
const DM_ALERT_EMOJI = '📩';  // 추가된 이모지
const UPDATE_INTERVAL_MS = 10000; // 10초

// 검증
if (!process.env.TOKEN) throw new Error("TOKEN 환경 변수가 필요합니다.");
if (!process.env.JSONBIN_API_KEY) throw new Error("JSONBIN_API_KEY 환경 변수가 필요합니다.");
if (!process.env.JSONBIN_BIN_ID) throw new Error("JSONBIN_BIN_ID 환경 변수가 필요합니다.");

const bossMessages = new Map();
const alertUsers = new Set();
const dmAlertUsers = new Set();  // DM 알림을 원하는 사용자 저장
const updateIntervals = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages  // DM을 위해 추가
    ]
});

// 보스 스케줄 정의 (기존 코드와 동일)
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

// 한국 시간 형식으로 변환 (기존 코드와 동일)
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

// 다음 보스 목록 가져오기 (기존 코드와 동일)
function getUpcomingBosses(now = new Date()) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const possibleBosses = [];

    for (let hourOffset = 0; hourOffset <= 6; hourOffset++) {
        const checkHour = (currentHour + hourOffset) % 24;
        const isOddHour = checkHour % 2 !== 0;

        bossSchedule.forEach(({ hourType, minute, boss }) => {
            if (hourType === '홀수' && !isOddHour) return;
            if (hourType === '짝수' && isOddHour) return;
            if (hourOffset === 0 && minute <= currentMinute) return;

            const bossDate = new Date(now);
            bossDate.setHours(checkHour, minute, 0, 0);

            if (bossDate <= now) {
                bossDate.setDate(bossDate.getDate() + 1);
            }

            const displayDate = new Date(bossDate.getTime() - 3 * 60 * 60 * 1000);
            const timeStr = `${displayDate.getHours().toString().padStart(2, '0')}:${displayDate.getMinutes().toString().padStart(2, '0')}`;

            possibleBosses.push({
                boss,
                date: bossDate,
                timeStr: timeStr
            });
        });
    }

    possibleBosses.sort((a, b) => a.date - b.date);
    return possibleBosses;
}

// JSONBin에서 데이터 가져오기 (기존 코드와 동일)
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

// JSONBin에 데이터 저장 (기존 코드와 동일)
async function saveMessageId(guildId, messageId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });

        const updatedRecord = response.data?.record || {};
        updatedRecord[guildId] = messageId;

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

// 이모지 등록자 확인 및 알림 전송 함수 수정 (DM 기능 추가)
async function checkEmojiReactionsAndNotify(guild) {
    try {
        const guildId = guild.id;
        const targetMessage = bossMessages.get(guildId);
        if (!targetMessage) return;

        const channel = targetMessage.channel;
        if (!channel) return;

        const role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
        if (!role) return;

        // 벨 이모지 반응 확인
        const bellReactions = targetMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
        if (bellReactions) {
            const users = await bellReactions.users.fetch();
            const reactingUserIds = new Set(users.filter(u => !u.bot).map(u => u.id));

            // 역할 동기화
            for (const [memberId, member] of role.members) {
                if (!reactingUserIds.has(memberId)) {
                    await member.roles.remove(role).catch(console.error);
                    console.log(`[${getKoreanTime()}] 🔄 ${member.user.tag} 사용자가 이모지를 누르지 않았지만 역할이 남아있어 제거했습니다.`);
                }
            }

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

            alertUsers.clear();
            for (const userId of reactingUserIds) {
                alertUsers.add(userId);
            }
        }

        // DM 이모지 반응 확인 (추가된 부분)
        const dmReactions = targetMessage.reactions.cache.get(DM_ALERT_EMOJI);
        if (dmReactions) {
            const users = await dmReactions.users.fetch();
            const reactingUserIds = new Set(users.filter(u => !u.bot).map(u => u.id));

            dmAlertUsers.clear();
            for (const userId of reactingUserIds) {
                dmAlertUsers.add(userId);
                console.log(`[${getKoreanTime()}] ✉️ ${userId} 사용자가 DM 알림 등록`);
            }
        }

        console.log(`[${getKoreanTime()}] 🔍 ${guild.name} 서버 이모지 상태 확인 완료: ${alertUsers.size}명 일반 알림, ${dmAlertUsers.size}명 DM 알림`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 이모지 상태 확인 실패:`, err.message);
    }
}

// 보스 메시지 업데이트 함수 수정 (DM 알림 추가)
async function updateBossMessage(guildId, channel, initialMessage) {
    if (updateIntervals.has(guildId)) {
        clearInterval(updateIntervals.get(guildId));
    }

    const intervalId = setInterval(async () => {
        try {
            const now = new Date();
            const bosses = getUpcomingBosses(now);
            if (bosses.length === 0) return;

            const nextBoss = bosses[0];
            const nextNextBoss = bosses[1] || { boss: '없음', timeStr: '-' };

            // 메인 메시지 업데이트 (이모지 설명 추가)
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('보스 알림 받기')
                .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
                .addFields(
                    { name: "📢 다음 보스", value: `**${nextBoss.boss}** (${nextBoss.timeStr})`, inline: false },
                    { name: "⏭️ 그 다음 보스", value: `**${nextNextBoss.boss}** (${nextNextBoss.timeStr})`, inline: false },
                    { name: "🔔 일반 알림", value: "이모지를 클릭하면 서버에서 멘션 알림을 받습니다.", inline: true },
                    { name: "📩 DM 알림", value: "이모지를 클릭하면 개인 DM으로 알림을 받습니다.", inline: true }
                )
                .setFooter({ text: `이모지를 클릭해서 원하는 알림을 받으세요!` });

            const bossMessage = bossMessages.get(guildId);
            if (bossMessage && bossMessage.editable) {
                await bossMessage.edit({ embeds: [embed] });
            }

            await checkEmojiReactionsAndNotify(channel.guild);

            // 1분 전 알림 로직 (DM 알림 추가)
            const timeUntilBoss = nextBoss.date.getTime() - now.getTime();
            
            if (timeUntilBoss <= 60000 && timeUntilBoss > 0) {
                const role = channel.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
                if (!role) {
                    console.error(`[${getKoreanTime()}] ❌ ${ALERT_ROLE_NAME} 역할을 찾을 수 없습니다.`);
                    return;
                }

                const membersWithRole = role.members.size;
                if (membersWithRole === 0 && dmAlertUsers.size === 0) {
                    console.log(`[${getKoreanTime()}] ⚠️ 알림을 받을 사용자가 없어 알림을 보내지 않습니다.`);
                    return;
                }

                if (!bossMessages.has(`${guildId}_alert_${nextBoss.boss}_${nextBoss.timeStr}`)) {
                    // 일반 알림 (서버 멘션)
                    if (membersWithRole > 0) {
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
                        
                        setTimeout(() => {
                            alertMessage.delete().catch(console.error);
                            console.log(`[${getKoreanTime()}] 🗑️ 보스 알림 메시지 삭제: ${nextBoss.boss}`);
                        }, 60000);
                    }

                    // DM 알림 (추가된 부분)
                    if (dmAlertUsers.size > 0) {
                        for (const userId of dmAlertUsers) {
                            try {
                                const user = await client.users.fetch(userId);
                                const dmEmbed = new EmbedBuilder()
                                    .setColor(0xFFA500)
                                    .setTitle('📩 보스 DM 알림')
                                    .setDescription(`**${nextBoss.boss}**가 ${bossLocations[nextBoss.boss]}에 1분 후 출현합니다!`)
                                    .addFields(
                                        { name: "출현 시간", value: nextBoss.timeStr, inline: true },
                                        { name: "서버", value: channel.guild.name, inline: true }
                                    )
                                    .setFooter({ text: `출현 예정 시간: ${nextBoss.timeStr}` });
                                
                                await user.send({ embeds: [dmEmbed] });
                                console.log(`[${getKoreanTime()}] ✉️ ${user.tag}에게 DM 알림 전송: ${nextBoss.boss}`);
                            } catch (dmErr) {
                                console.error(`[${getKoreanTime()}] ❌ ${userId} 사용자에게 DM 전송 실패:`, dmErr.message);
                            }
                        }
                    }

                    bossMessages.set(`${guildId}_alert_${nextBoss.boss}_${nextBoss.timeStr}`, true);
                    setTimeout(() => {
                        bossMessages.delete(`${guildId}_alert_${nextBoss.boss}_${nextBoss.timeStr}`);
                    }, 60000);

                    // 위더와 쿵푸에 대해 25분 후 쿨타임 알림 추가
                    if (nextBoss.boss === '위더' || nextBoss.boss === '쿵푸') {
                        setTimeout(async () => {
                            const role = channel.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
                            if (!role) return;

                            const membersWithRole = role.members.size;
                            if (membersWithRole === 0 && dmAlertUsers.size === 0) return;

                            const cooldownAlertEmbed = new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle('🔄 보스 쿨타임 알림')
                                .setDescription(`**${nextBoss.boss}** 보스 쿨타임이 돌아왔습니다. 확인해주세요!`)
                                .addFields(
                                    { name: "위치", value: bossLocations[nextBoss.boss], inline: true },
                                    { name: "알림", value: "이 알림은 1분 후에 자동으로 삭제됩니다.", inline: false }
                                );

                            // 일반 알림
                            if (membersWithRole > 0) {
                                const mentions = Array.from(alertUsers).map(id => `<@${id}>`).join(' ');
                                const cooldownAlertMessage = await channel.send({
                                    content: `**${nextBoss.boss}** 보스 쿨타임이 돌아왔습니다! ${mentions}`,
                                    embeds: [cooldownAlertEmbed],
                                    allowedMentions: { users: Array.from(alertUsers) }
                                });

                                setTimeout(() => {
                                    cooldownAlertMessage.delete().catch(console.error);
                                }, 60000);
                            }

                            // DM 알림
                            if (dmAlertUsers.size > 0) {
                                for (const userId of dmAlertUsers) {
                                    try {
                                        const user = await client.users.fetch(userId);
                                        const dmCooldownEmbed = new EmbedBuilder()
                                            .setColor(0x00FF00)
                                            .setTitle('📩 보스 쿨타임 알림')
                                            .setDescription(`**${nextBoss.boss}** 보스 쿨타임이 돌아왔습니다.`)
                                            .addFields(
                                                { name: "위치", value: bossLocations[nextBoss.boss], inline: true },
                                                { name: "서버", value: channel.guild.name, inline: true }
                                            );
                                        
                                        await user.send({ embeds: [dmCooldownEmbed] });
                                    } catch (dmErr) {
                                        console.error(`[${getKoreanTime()}] ❌ ${userId} 사용자에게 DM 전송 실패:`, dmErr.message);
                                    }
                                }
                            }

                            console.log(`[${getKoreanTime()}] 🔄 ${nextBoss.boss} 쿨타임 알림 전송 완료`);
                        }, 25 * 60 * 1000); // 25분 후 알림
                    }
                }
            }
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ 보스 메시지 업데이트 실패:`, err.message);
        }
    }, UPDATE_INTERVAL_MS);

    updateIntervals.set(guildId, intervalId);
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('/')) return;

    if (message.channel.name !== BOSS_CHANNEL_NAME) {
        const reply = await message.channel.send("⚠️ 이 명령어는 #보스알림 채널에서만 사용 가능합니다.");
        setTimeout(() => reply.delete(), 3000);
        return;
    }
        
    try {
        // ... 기존 명령어들 ...

        // ▼▼▼ 수정된 명령어 (관리자 제한 제거) ▼▼▼
        if (message.content.startsWith('/알림초기화')) {
            // 기존 봇 메시지 일괄 삭제
            const messages = await message.channel.messages.fetch();
            const deletionPromises = messages.filter(m => 
                m.author.bot && m.id !== message.id
            ).map(msg => 
                msg.delete().catch(e => 
                    console.error(`[${getKoreanTime()}] 메시지 삭제 실패: ${e.message}`)
                )
            );

            await Promise.all(deletionPromises);
            
            // 새 알림 메시지 생성
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('보스 알림 시스템 초기화 완료')
                .setDescription('아래 이모지를 클릭해 알림을 다시 설정해주세요')
                .addFields(
                    { name: "🔔 일반 알림", value: "서버 내 멘션 알림", inline: true },
                    { name: "📩 DM 알림", value: "개인 메시지 알림", inline: true }
                );

            const bossMessage = await message.channel.send({ embeds: [embed] });
            await bossMessage.react(BOSS_ALERT_EMOJI);
            await bossMessage.react(DM_ALERT_EMOJI);
            
            // 시스템 재설정
            const guildId = message.guild.id;
            bossMessages.set(guildId, bossMessage);
            await saveMessageId(guildId, bossMessage.id);
            updateBossMessage(guildId, message.channel, bossMessage);
            
            const reply = await message.channel.send("✅ 알림 시스템이 초기화되었습니다. 이 메시지는 5초 후 삭제됩니다.");
            setTimeout(() => reply.delete(), 5000);
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

// 반응 추가 처리 (DM 이모지 처리 추가)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    
    try {
        const guildId = reaction.message.guild.id;
        const targetMessage = bossMessages.get(guildId);
        
        if (!targetMessage || reaction.message.id !== targetMessage.id) return;

        // 벨 이모지 처리
        if (reaction.emoji.name === BOSS_ALERT_EMOJI) {
            let member = reaction.message.guild.members.cache.get(user.id);
            if (!member) {
                member = await reaction.message.guild.members.fetch(user.id);
            }

            let role = reaction.message.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
            if (!role) {
                role = await reaction.message.guild.roles.create({
                    name: ALERT_ROLE_NAME,
                    mentionable: true,
                    reason: '보스 알림을 위한 역할 자동 생성'
                });
            }

            await member.roles.add(role);
            alertUsers.add(user.id);
            
            console.log(`[${getKoreanTime()}] ✅ ${user.tag} 알림 등록 및 역할 부여`);
        }
        // DM 이모지 처리 (추가된 부분)
        else if (reaction.emoji.name === DM_ALERT_EMOJI) {
            dmAlertUsers.add(user.id);
            console.log(`[${getKoreanTime()}] ✉️ ${user.tag} DM 알림 등록`);
            
            // DM으로 확인 메시지 보내기
            try {
                const dmEmbed = new EmbedBuilder()
                    .setColor(0x7289DA)
                    .setTitle('📩 DM 알림 등록 완료')
                    .setDescription(`보스 출현 1분 전에 DM으로 알림을 보내드립니다.\n\n서버: ${reaction.message.guild.name}`)
                    .setFooter({ text: '알림을 취소하려면 이모지를 다시 클릭해주세요.' });
                
                await user.send({ embeds: [dmEmbed] });
            } catch (dmErr) {
                console.error(`[${getKoreanTime()}] ❌ ${user.tag}에게 DM 전송 실패:`, dmErr.message);
            }
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 반응 추가 처리 오류:`, err.message);
    }
});

// 반응 제거 처리 (DM 이모지 처리 추가)
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    
    try {
        const guildId = reaction.message.guild.id;
        const targetMessage = bossMessages.get(guildId);
        
        if (!targetMessage || reaction.message.id !== targetMessage.id) return;

        // 벨 이모지 처리
        if (reaction.emoji.name === BOSS_ALERT_EMOJI) {
            let member = reaction.message.guild.members.cache.get(user.id);
            if (!member) {
                member = await reaction.message.guild.members.fetch(user.id);
            }

            const role = reaction.message.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);

            if (role && member.roles.cache.has(role.id)) {
                await member.roles.remove(role);
                alertUsers.delete(user.id);
                console.log(`[${getKoreanTime()}] 🔕 ${user.tag} 알림 해제 및 역할 제거`);
                
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
        // DM 이모지 처리 (추가된 부분)
        else if (reaction.emoji.name === DM_ALERT_EMOJI) {
            dmAlertUsers.delete(user.id);
            console.log(`[${getKoreanTime()}] ✉️ ${user.tag} DM 알림 해제`);
            
            // DM으로 취소 메시지 보내기
            try {
                const dmEmbed = new EmbedBuilder()
                    .setColor(0xFF6347)
                    .setTitle('📩 DM 알림 취소 완료')
                    .setDescription(`더 이상 보스 출현 DM 알림을 받지 않습니다.\n\n서버: ${reaction.message.guild.name}`)
                    .setFooter({ text: '다시 등록하려면 이모지를 클릭해주세요.' });
                
                await user.send({ embeds: [dmEmbed] });
            } catch (dmErr) {
                console.error(`[${getKoreanTime()}] ❌ ${user.tag}에게 DM 전송 실패:`, dmErr.message);
            }
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 반응 제거 처리 오류:`, err.message);
    }
});

// 봇 준비 완료 시 (메시지 생성 시 이모지 추가)
client.once('ready', async () => {
    console.log(`[${getKoreanTime()}] ✅ ${client.user.tag} 봇이 온라인입니다!`);
    console.log(`[${getKoreanTime()}] 🟢 봇 시작 - ${new Date().toISOString()}`);
    
    updateIntervals.forEach(interval => clearInterval(interval));
    updateIntervals.clear();

    for (const [guildId, guild] of client.guilds.cache) {
        try {
            // 역할 초기화 및 생성 (기존 코드와 동일)
            let role = guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
            if (!role) {
                role = await guild.roles.create({
                    name: ALERT_ROLE_NAME,
                    mentionable: true,
                    reason: '보스 알림을 위한 역할 자동 생성'
                });
                console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버에 ${ALERT_ROLE_NAME} 역할 생성 완료`);
            } else {
                const membersWithRole = role.members;
                if (membersWithRole.size > 0) {
                    const removePromises = membersWithRole.map(member => 
                        member.roles.remove(role).catch(console.error)
                    );
                    await Promise.all(removePromises);
                    console.log(`[${getKoreanTime()}] 🔄 ${guild.name} 서버의 기존 ${ALERT_ROLE_NAME} 역할 보유자 ${membersWithRole.size}명에서 역할 제거 완료`);
                }
            }

            // 채널 찾기 (기존 코드와 동일)
            const bossAlertChannel = guild.channels.cache.find(c => 
                c.name === BOSS_CHANNEL_NAME && 
                c.type === 0 &&
                c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
            );

            if (!bossAlertChannel) {
                console.error(`[${getKoreanTime()}] ❌ '${guild.name}' 서버에서 '${BOSS_CHANNEL_NAME}' 채널을 찾을 수 없거나 권한이 없습니다.`);
                continue;
            }

            let bossMessage = null;
            const savedMessageId = await getSavedMessageId(guildId);

            // 저장된 메시지 불러오기 시도 (기존 코드와 동일)
            if (savedMessageId) {
                try {
                    bossMessage = await bossAlertChannel.messages.fetch(savedMessageId);
                    
                    const reactions = bossMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
                    if (reactions) {
                        const users = await reactions.users.fetch();
                        
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

            // 새 메시지 생성 (기존 메시지가 없는 경우)
            if (!bossMessage) {
                const embed = new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle('보스 알림 받기')
                    .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
                    .addFields(
                        { name: "📢 다음 보스", value: `불러오는 중...` },
                        { name: "🔔 일반 알림", value: "이모지를 클릭하면 서버에서 멘션 알림을 받습니다.", inline: true },
                        { name: "📩 DM 알림", value: "이모지를 클릭하면 개인 DM으로 알림을 받습니다.", inline: true }
                    )
                    .setFooter({ text: `이모지를 클릭해서 원하는 알림을 받으세요!` });

                bossMessage = await bossAlertChannel.send({ embeds: [embed] });
                await bossMessage.react(BOSS_ALERT_EMOJI);
                await bossMessage.react(DM_ALERT_EMOJI);  // DM 이모지 추가
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

// 역할 동기화 함수 (기존 코드와 동일)
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

// 상태 모니터링 및 주기적 동기화 (기존 코드와 동일)
setInterval(() => {
    console.log(`[${getKoreanTime()}] ℹ️ 봇 상태: 
        ${client.guilds.cache.size} 서버, 
        ${client.ws.ping}ms 핑, 
        ${process.memoryUsage().rss / 1024 / 1024}MB 메모리 사용`);

    client.guilds.cache.forEach(guild => {
        syncRolesWithReactions(guild).catch(console.error);
    });
}, 3600000);

// 봇 로그인 (기존 코드와 동일)
client.login(process.env.TOKEN).catch(err => {
    console.error(`[${getKoreanTime()}] ❌ 봇 로그인 실패:`, err.message);
    process.exit(1);
});

// 종료 핸들러 (기존 코드와 동일)
function cleanup() {
    console.log(`[${getKoreanTime()}] 🔴 봇 종료 중...`);
    
    updateIntervals.forEach(interval => clearInterval(interval));
    updateIntervals.clear();
    
    client.destroy();
    process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (err) => {
    console.error(`[${getKoreanTime()}] ❌ 처리되지 않은 예외:`, err);
    cleanup();
});
