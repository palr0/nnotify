
import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import './server.js';

// 환경 변수 로드
dotenv.config();

// 상수 정의
const BOSS_CHANNEL_NAME = '🔔-보스알림';
const CLEAR_CHANNEL_NAME = '클리어확인';
const PARTY_CHANNEL_NAME = '파티명단＃레이드';
const ALERT_ROLE_NAME = '보스알림';
const BOSS_ALERT_EMOJI = '🔔';
const DM_ALERT_EMOJI = '📩';
const UPDATE_INTERVAL_MS = 10000;
const RAID_BOSSES = ['엑소', '테라'];
const DIFFICULTIES = ['노말', '하드', '노말하드'];

// 검증
if (!process.env.TOKEN) throw new Error("TOKEN 환경 변수가 필요합니다.");
if (!process.env.JSONBIN_API_KEY) throw new Error("JSONBIN_API_KEY 환경 변수가 필요합니다.");
if (!process.env.JSONBIN_BIN_ID) throw new Error("JSONBIN_BIN_ID 환경 변수가 필요합니다.");

// 데이터 저장 구조
const bossMessages = new Map();
const alertUsers = new Set();
const dmAlertUsers = new Set();
const updateIntervals = new Map();
const clearData = new Map();
const partyData = new Map();

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

// 클리어 명령어 처리
async function handleClearCommand(message) {
    const args = message.content.split(/\s+/);
    const command = args[1];
    const bossName = args[2];
    const difficulty = args[3];
    const username = args[4] || message.author.username;

    if (!command) {
        const reply = await message.channel.send("사용법: /클 [엑소/테라] [노말/하드/노말하드] 또는 /클 제거 [닉네임]");
        setTimeout(() => reply.delete(), 5000);
        return;
    }

    const guildId = message.guild.id;
    if (!clearData.has(guildId)) {
        clearData.set(guildId, {
            '엑소': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() },
            '테라': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() }
        });
    }

    const guildData = clearData.get(guildId);

    if (command === '제거') {
        let removed = false;
        for (const boss of RAID_BOSSES) {
            for (const diff of DIFFICULTIES) {
                if (guildData[boss][diff].has(username)) {
                    guildData[boss][diff].delete(username);
                    removed = true;
                }
            }
        }

        if (removed) {
            const reply = await message.channel.send(`${username} 님을 모든 클리어 목록에서 제거했습니다.`);
            setTimeout(() => reply.delete(), 3000);
        } else {
            const reply = await message.channel.send(`${username} 님은 클리어 목록에 없습니다.`);
            setTimeout(() => reply.delete(), 3000);
        }
    } else {
        if (!RAID_BOSSES.includes(bossName)) {
            const reply = await message.channel.send("보스 이름은 '엑소' 또는 '테라'만 가능합니다.");
            setTimeout(() => reply.delete(), 3000);
            return;
        }

        if (!DIFFICULTIES.includes(difficulty)) {
            const reply = await message.channel.send("난이도는 '노말', '하드', '노말하드'만 가능합니다.");
            setTimeout(() => reply.delete(), 3000);
            return;
        }

        if (difficulty === '노말하드') {
            guildData[bossName]['노말'].add(username);
            guildData[bossName]['하드'].add(username);
        } else {
            guildData[bossName][difficulty].add(username);
        }

        const reply = await message.channel.send(`${username} 님이 ${bossName} ${difficulty} 클리어 목록에 추가되었습니다.`);
        setTimeout(() => reply.delete(), 3000);
    }

    await updateClearMessage(message.channel, guildId);
}

// 클리어 목록 업데이트
async function updateClearMessage(channel, guildId) {
    const guildData = clearData.get(guildId) || {
        '엑소': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() },
        '테라': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() }
    };

    let messageContent = '';
    for (const boss of RAID_BOSSES) {
        messageContent += `\n\n**${boss} 클리어명단**`;
        for (const diff of DIFFICULTIES) {
            if (diff === '노말하드') continue;
            const users = Array.from(guildData[boss][diff]).join('\n');
            if (users) messageContent += `\n${diff}:\n${users}`;
        }
    }

    const messages = await channel.messages.fetch({ limit: 10 });
    const clearMessage = messages.find(m => m.author.bot && m.content.includes('클리어명단'));

    if (clearMessage) {
        await clearMessage.edit(messageContent.trim());
    } else {
        await channel.send(messageContent.trim());
    }
}

// 파티 명령어 처리
async function handlePartyCommand(message) {
    const args = message.content.split(/\s+/);
    const command = args[1];

    if (!command) {
        const reply = await message.channel.send(
            "사용법:\n" +
            "/파티 생성 [제목]\n" +
            "/파티 제목 변경 [기존제목] [새제목]\n" +
            "/파티 목록 등록 [파티제목] [이름]\n" +
            "/파티 목록 제거 [파티제목] [이름]\n" +
            "/파티 일정 [파티제목] [내용]\n" +
            "/파티 일정 변경 [파티제목] [내용]\n" +
            "/파티 제거 [파티제목]\n" +
            "/파티 채널 초기화"
        );
        setTimeout(() => reply.delete(), 10000);
        return;
    }

    const guildId = message.guild.id;
    if (!partyData.has(guildId)) {
        partyData.set(guildId, {});
    }

    const guildParties = partyData.get(guildId);

    try {
        switch (command) {
            case '생성':
                const partyName = args.slice(2).join(' ');
                if (!partyName) throw new Error("파티 제목을 입력해주세요.");
                if (guildParties[partyName]) throw new Error("이미 존재하는 파티 제목입니다.");
                guildParties[partyName] = { members: new Set(), schedule: '' };
                await message.channel.send(`파티 '${partyName}'가 생성되었습니다.`);
                break;

            case '제목':
                if (args[2] !== '변경') break;
                const oldName = args[3];
                const newName = args.slice(4).join(' ');
                if (!guildParties[oldName]) throw new Error("존재하지 않는 파티 제목입니다.");
                guildParties[newName] = guildParties[oldName];
                delete guildParties[oldName];
                await message.channel.send(`파티 제목이 '${oldName}'에서 '${newName}'(으)로 변경되었습니다.`);
                break;

            case '목록':
                const subCommand = args[2];
                const targetParty = args[3];
                const name = args.slice(4).join(' ');
                
                if (!guildParties[targetParty]) throw new Error("존재하지 않는 파티 제목입니다.");
                
                if (subCommand === '등록') {
                    guildParties[targetParty].members.add(name);
                    await message.channel.send(`'${name}'님이 파티 '${targetParty}'에 추가되었습니다.`);
                } else if (subCommand === '제거') {
                    guildParties[targetParty].members.delete(name);
                    await message.channel.send(`'${name}'님이 파티 '${targetParty}'에서 제거되었습니다.`);
                }
                break;

            case '일정':
                const partyForSchedule = args[2];
                const scheduleContent = args.slice(3).join(' ');
                
                if (args[2] === '변경') {
                    const partyToChange = args[3];
                    const newSchedule = args.slice(4).join(' ');
                    
                    if (!guildParties[partyToChange]) throw new Error("존재하지 않는 파티 제목입니다.");
                    guildParties[partyToChange].schedule = newSchedule;
                    await message.channel.send(`파티 '${partyToChange}'의 일정이 변경되었습니다.`);
                } else {
                    if (!guildParties[partyForSchedule]) throw new Error("존재하지 않는 파티 제목입니다.");
                    guildParties[partyForSchedule].schedule = scheduleContent;
                    await message.channel.send(`파티 '${partyForSchedule}'의 일정이 설정되었습니다.`);
                }
                break;

            case '제거':
                const partyToRemove = args.slice(2).join(' ');
                if (!guildParties[partyToRemove]) throw new Error("존재하지 않는 파티 제목입니다.");
                delete guildParties[partyToRemove];
                await message.channel.send(`파티 '${partyToRemove}'가 삭제되었습니다.`);
                break;

            case '채널':
                if (args[2] === '초기화') {
                    const messages = await message.channel.messages.fetch({ limit: 100 });
                    await Promise.all(messages.map(msg => 
                        msg.delete().catch(e => console.error(`메시지 삭제 실패: ${e.message}`))
                    );
                    await message.channel.send("채널이 초기화되었습니다. 이 메시지는 5초 후 삭제됩니다.");
                    setTimeout(() => message.channel.lastMessage?.delete(), 5000);
                }
                break;

            default:
                throw new Error("알 수 없는 명령어입니다.");
        }

        await updatePartyMessages(message.channel, guildId);
    } catch (err) {
        const reply = await message.channel.send(`오류: ${err.message}\n이 메시지는 5초 후 삭제됩니다.`);
        setTimeout(() => reply.delete(), 5000);
    }
}

// 파티 목록 업데이트
async function updatePartyMessages(channel, guildId) {
    const guildParties = partyData.get(guildId) || {};
    const messages = await channel.messages.fetch({ limit: 50 });
    await Promise.all(messages.filter(m => m.author.bot).map(msg => 
        msg.delete().catch(console.error)
    );

    for (const [partyName, partyInfo] of Object.entries(guildParties)) {
        let content = `**${partyName}**\n\n`;
        content += partyInfo.members.size > 0 
            ? Array.from(partyInfo.members).join('\n') + '\n\n' 
            : "멤버 없음\n\n";
        content += `일정: ${partyInfo.schedule || "없음"}`;
        await channel.send(content);
    }
}

// 이모지 등록자 확인 및 알림 전송
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

        // DM 이모지 반응 확인
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

// 보스 메시지 업데이트
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

            // 메인 메시지 업데이트
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

            // 1분 전 알림 로직
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

                    // DM 알림
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('/')) return;

    // 클리어확인 채널 명령어 처리
    if (message.channel.name === CLEAR_CHANNEL_NAME && message.content.startsWith('/클')) {
        await handleClearCommand(message);
        return;
    }

    // 파티명단 채널 명령어 처리
    if (message.channel.name === PARTY_CHANNEL_NAME && message.content.startsWith('/파티')) {
        await handlePartyCommand(message);
        return;
    }

    // 보스알림 채널 명령어 처리
    if (message.channel.name !== BOSS_CHANNEL_NAME) {
        const reply = await message.channel.send("⚠️ 이 명령어는 #보스알림 채널에서만 사용 가능합니다.");
        setTimeout(() => reply.delete(), 3000);
        return;
    }

    // 기존 보스알림 명령어 처리
    try {
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
        // DM 이모지 처리
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
        // DM 이모지 처리
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

client.once('ready', async () => {
    console.log(`[${getKoreanTime()}] ✅ ${client.user.tag} 봇이 온라인입니다!`);
    console.log(`[${getKoreanTime()}] 🟢 봇 시작 - ${new Date().toISOString()}`);
    
    updateIntervals.forEach(interval => clearInterval(interval));
    updateIntervals.clear();

    for (const [guildId, guild] of client.guilds.cache) {
        try {
            // 역할 초기화
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
                    await Promise.all(membersWithRole.map(member => 
                        member.roles.remove(role).catch(console.error)
                    ));
                    console.log(`[${getKoreanTime()}] 🔄 ${guild.name} 서버의 기존 ${ALERT_ROLE_NAME} 역할 보유자 ${membersWithRole.size}명에서 역할 제거 완료`);
                }
            }

            // 보스알림 채널 설정
            const bossAlertChannel = guild.channels.cache.find(c => 
                c.name === BOSS_CHANNEL_NAME && 
                c.type === 0 &&
                c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
            );

            if (bossAlertChannel) {
                let bossMessage = null;
                const savedMessageId = await getSavedMessageId(guildId);

                if (savedMessageId) {
                    try {
                        bossMessage = await bossAlertChannel.messages.fetch(savedMessageId);
                        const reactions = bossMessage.reactions.cache.get(BOSS_ALERT_EMOJI);
                        if (reactions) {
                            const users = await reactions.users.fetch();
                            await Promise.all(users.filter(u => !u.bot).map(async user => {
                                try {
                                    const member = await guild.members.fetch(user.id);
                                    await member.roles.add(role);
                                    alertUsers.add(user.id);
                                    console.log(`[${getKoreanTime()}] ✅ ${user.tag} 기존 알림 등록자 역할 자동 부여`);
                                } catch (err) {
                                    console.error(`[${getKoreanTime()}] ❌ ${user.tag} 역할 부여 실패:`, err.message);
                                }
                            }));
                        }
                        bossMessages.set(guildId, bossMessage);
                        console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버 이전 메시지 불러오기 성공: ${bossMessage.id}`);
                    } catch (fetchErr) {
                        console.error(`[${getKoreanTime()}] ⚠️ ${guild.name} 서버에서 메시지 불러오기 실패:`, fetchErr.message);
                    }
                }

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
                    await bossMessage.react(DM_ALERT_EMOJI);
                    bossMessages.set(guildId, bossMessage);
                    await saveMessageId(guildId, bossMessage.id);
                    console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버에 새 메시지 생성: ${bossMessage.id}`);
                }

                updateBossMessage(guildId, bossAlertChannel, bossMessage);
            }

            // 클리어 데이터 초기화
            if (!clearData.has(guildId)) {
                clearData.set(guildId, {
                    '엑소': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() },
                    '테라': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() }
                });
            }

            // 파티 데이터 초기화
            if (!partyData.has(guildId)) {
                partyData.set(guildId, {});
            }

            // 클리어확인 채널 초기 메시지 생성
            const clearChannel = guild.channels.cache.find(c => c.name === CLEAR_CHANNEL_NAME);
            if (clearChannel) await updateClearMessage(clearChannel, guildId);

            // 파티 채널 초기화
            const partyChannel = guild.channels.cache.find(c => c.name === PARTY_CHANNEL_NAME);
            if (partyChannel) await updatePartyMessages(partyChannel, guildId);

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
}, 3600000);

// 봇 로그인
client.login(process.env.TOKEN).catch(err => {
    console.error(`[${getKoreanTime()}] ❌ 봇 로그인 실패:`, err.message);
    process.exit(1);
});

// 종료 핸들러
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
