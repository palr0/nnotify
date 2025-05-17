import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, SlashCommandBuilder, Routes, REST } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import './server.js';
import { ActivityType } from 'discord.js';

// 환경 변수 로드
dotenv.config();

// 상수 정의
const BOSS_CHANNEL_NAME = '🔔ㅣ보스알림';
const CLEAR_CHANNEL_NAME = '🐸ㅣ클리어확인';
const PARTY_CHANNEL_NAME = '😳ㅣ파티명단＃레이드';
const DUNGEON_CHANNEL_NAME = '📅ㅣ오늘의던전';
const ALERT_ROLE_NAME = '🔔ㅣ보스알림';
const BOSS_ALERT_EMOJI = '🔔';
const DM_ALERT_EMOJI = '📩';
const UPDATE_INTERVAL_MS = 10000;
const RAID_BOSSES = ['엑소', '테라'];
const DIFFICULTIES = ['노말', '하드', '노말하드'];
// REST 인스턴스를 전역으로 선언
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
//client = commands.Bot(command_prefix = '-')
const dungeonImages = {
    '금화 저장고': 'https://github.com/palr0/nnotify/blob/main/image/gold.png?raw=true',
    '불안정한 제련소': 'https://github.com/palr0/nnotify/blob/main/image/ref.png?raw=true',
    '레이드': 'https://github.com/palr0/nnotify/blob/main/image/raid.png?raw=true',
    '차원의 틈': 'https://github.com/palr0/nnotify/blob/main/image/dimen.png?raw=true'
};

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

async function savePartyData(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });

        const guildParties = partyData.get(guildId) || {};
        const partyDataToSave = {};

        // 객체를 순회하며 데이터 변환
        for (const [partyName, partyInfo] of Object.entries(guildParties)) {
            partyDataToSave[partyName] = {
                members: Array.from(partyInfo.members || []),
                schedule: partyInfo.schedule || ''
            };
        }

        const updatedRecord = response.data?.record || {};
        updatedRecord[`${guildId}_party`] = partyDataToSave;

        await axios.put(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}`, updatedRecord, {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': process.env.JSONBIN_API_KEY,
                'X-Bin-Versioning': 'false'
            }
        });

        console.log(`[${getKoreanTime()}] ✅ 파티 데이터 저장 완료 (${guildId})`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 파티 데이터 저장 실패:`, err.message);
    }
}

async function loadPartyData(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });

        const savedData = response.data.record[`${guildId}_party`] || {};
        const loadedData = {};

        for (const [partyName, partyInfo] of Object.entries(savedData)) {
            loadedData[partyName] = {
                members: new Set(partyInfo.members || []),
                schedule: partyInfo.schedule || ''
            };
        }

        partyData.set(guildId, loadedData);
        console.log(`[${getKoreanTime()}] ✅ 파티 데이터 로드 완료 (${guildId})`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 파티 데이터 로드 실패:`, err.message);
        partyData.set(guildId, {});
    }
}

// 클리어 명령어 처리
async function handleClearCommand(interaction) {
    const command = interaction.options.getSubcommand();
    const bossName = interaction.options.getString('보스');
    const difficulty = interaction.options.getString('난이도');
    const username = interaction.options.getString('닉네임') || interaction.user.username;

    const guildId = interaction.guild.id;
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
            await interaction.reply({ content: `${username} 님을 모든 클리어 목록에서 제거했습니다.`, ephemeral: true });
        } else {
            await interaction.reply({ content: `${username} 님은 클리어 목록에 없습니다.`, ephemeral: true });
        }
    } else {
        if (!RAID_BOSSES.includes(bossName)) {
            await interaction.reply({ content: "보스 이름은 '엑소' 또는 '테라'만 가능합니다.", ephemeral: true });
            return;
        }

        if (!DIFFICULTIES.includes(difficulty)) {
            await interaction.reply({ content: "난이도는 '노말', '하드', '노말하드'만 가능합니다.", ephemeral: true });
            return;
        }

        if (difficulty === '노말하드') {
            guildData[bossName]['노말'].add(username);
            guildData[bossName]['하드'].add(username);
        } else {
            guildData[bossName][difficulty].add(username);
        }

        await interaction.reply({ content: `${username} 님이 ${bossName} ${difficulty} 클리어 목록에 추가되었습니다.`, ephemeral: true });
    }

    await updateClearMessage(interaction.channel, guildId);
}

// JSONBin에서 클리어 메시지 ID 가져오기
async function getSavedClearMessageId(guildId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });
        return response.data.record[`${guildId}_clear`];
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 클리어 메시지 ID 불러오기 실패:`, err.message);
        return null;
    }
}

// JSONBin에 클리어 메시지 ID 저장
async function saveClearMessageId(guildId, messageId) {
    try {
        const response = await axios.get(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': process.env.JSONBIN_API_KEY }
        });

        const updatedRecord = response.data?.record || {};
        updatedRecord[`${guildId}_clear`] = messageId;

        await axios.put(`https://api.jsonbin.io/v3/b/${process.env.JSONBIN_BIN_ID}`, updatedRecord, {
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': process.env.JSONBIN_API_KEY,
                'X-Bin-Versioning': 'false'
            }
        });

        console.log(`[${getKoreanTime()}] ✅ 클리어 메시지 ID 저장됨 (${guildId}): ${messageId}`);
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 클리어 메시지 ID 저장 실패:`, err.message);
    }
}

// 클리어 목록 업데이트 (수정된 버전)
async function updateClearMessage(channel, guildId) {
    const guildData = clearData.get(guildId) || {
        '엑소': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() },
        '테라': { '노말': new Set(), '하드': new Set(), '노말하드': new Set() }
    };

    // 사용자별 클리어 정보 수집
    const userClearData = {};
    
    for (const boss of RAID_BOSSES) {
        for (const diff of DIFFICULTIES) {
            if (diff === '노말하드') continue;
            
            const users = guildData[boss][diff];
            users.forEach(username => {
                if (!userClearData[username]) {
                    userClearData[username] = {};
                }
                if (!userClearData[username][boss]) {
                    userClearData[username][boss] = [];
                }
                userClearData[username][boss].push(diff);
            });
        }
    }

    // 메시지 생성 (보스 이름 변경: 엑소 → 엑소니아, 테라 → 테라곤)
    let messageContent = '';
    for (const boss of RAID_BOSSES) {
        const displayName = boss === '엑소' ? '엑소니아' : '테라곤';
        messageContent += `\n\n**${displayName} 클리어명단**`;
        
        const bossUsers = Object.entries(userClearData)
            .filter(([_, bosses]) => boss in bosses)
            .map(([username, bosses]) => {
                const diffs = bosses[boss].join(', ');
                return `${username}: ${diffs}`;
            });
            
        if (bossUsers.length > 0) {
            messageContent += `\n${bossUsers.join('\n')}`;
        } else {
            messageContent += `\n없음`;
        }
    }

    // 기존 메시지 찾기 또는 생성
    const messages = await channel.messages.fetch({ limit: 10 });
    let clearMessage = messages.find(m => m.author.bot && m.content.includes('클리어명단'));

    if (!clearMessage) {
        // 저장된 메시지 ID 확인
        const savedMessageId = await getSavedClearMessageId(guildId);
        if (savedMessageId) {
            try {
                clearMessage = await channel.messages.fetch(savedMessageId);
            } catch (err) {
                console.error(`[${getKoreanTime()}] ❌ 저장된 클리어 메시지 불러오기 실패:`, err.message);
            }
        }
    }

    if (clearMessage) {
        await clearMessage.edit(messageContent.trim());
    } else {
        clearMessage = await channel.send(messageContent.trim());
        await saveClearMessageId(guildId, clearMessage.id);
    }
}
// 파티 명령어 처리
async function handlePartyCommand(interaction) {
    const command = interaction.options.getSubcommand();
    const subCommand = interaction.options.getSubcommandGroup();
    const guildId = interaction.guild.id;

    if (!partyData.has(guildId)) {
        partyData.set(guildId, {});
    }

    const guildParties = partyData.get(guildId);

    try {
        if (command === '생성') {
            const partyName = interaction.options.getString('제목');
            if (!partyName) throw new Error("파티 제목을 입력해주세요.");
            if (guildParties[partyName]) throw new Error("이미 존재하는 파티 제목입니다.");
            
            guildParties[partyName] = { members: new Set(), schedule: '' };
            await savePartyData(guildId);
            await interaction.reply({ content: `파티 '${partyName}'가 생성되었습니다.`, ephemeral: true });
        }
        else if (subCommand === '수정') {
            const targetParty = interaction.options.getString('파티제목');
            const oldName = interaction.options.getString('기존이름');
            const newName = interaction.options.getString('새이름');
            
            if (!guildParties[targetParty]) throw new Error("존재하지 않는 파티 제목입니다.");
            if (!guildParties[targetParty].members.has(oldName)) {
                throw new Error(`'${oldName}'님은 파티 '${targetParty}'에 존재하지 않습니다.`);
            }
            
            guildParties[targetParty].members.delete(oldName);
            guildParties[targetParty].members.add(newName);
            await savePartyData(guildId);
            await interaction.reply({ 
                content: `파티 '${targetParty}'의 '${oldName}'님이 '${newName}'(으)로 수정되었습니다.`, 
                ephemeral: true 
            });
        }
        else if (subCommand === '제목') {
            const oldName = interaction.options.getString('기존제목');
            const newName = interaction.options.getString('새제목');
            if (!guildParties[oldName]) throw new Error("존재하지 않는 파티 제목입니다.");
            
            guildParties[newName] = guildParties[oldName];
            delete guildParties[oldName];
            await savePartyData(guildId);
            await interaction.reply({ content: `파티 제목이 '${oldName}'에서 '${newName}'(으)로 변경되었습니다.`, ephemeral: true });
        }
        else if (subCommand === '목록') {
            const targetParty = interaction.options.getString('파티제목');
            const name = interaction.options.getString('이름');
            const position = interaction.options.getInteger('위치') || -1;
            
            if (!guildParties[targetParty]) throw new Error("존재하지 않는 파티 제목입니다.");
            
            if (command === '등록') {
                if (position >= 0) {
                    const membersArray = Array.from(guildParties[targetParty].members);
                    membersArray.splice(position, 0, name);
                    guildParties[targetParty].members = new Set(membersArray);
                } else {
                    guildParties[targetParty].members.add(name);
                }
                await savePartyData(guildId);
                await interaction.reply({ 
                    content: `'${name}'님이 파티 '${targetParty}'에 ${position >= 0 ? position + '번 위치에 ' : ''}추가되었습니다.`, 
                    ephemeral: true 
                });
            } 
            else if (command === '제거') {
                guildParties[targetParty].members.delete(name);
                await savePartyData(guildId);
                await interaction.reply({ content: `'${name}'님이 파티 '${targetParty}'에서 제거되었습니다.`, ephemeral: true });
            }
        }
        else if (subCommand === '일정') {
            const partyName = interaction.options.getString('파티제목');
            const scheduleContent = interaction.options.getString('내용');
            
            if (!guildParties[partyName]) throw new Error("존재하지 않는 파티 제목입니다.");
            
            if (command === '등록' || command === '변경') {
                guildParties[partyName].schedule = scheduleContent;
                await savePartyData(guildId);
                await interaction.reply({ 
                    content: `파티 '${partyName}'의 일정이 ${command === '등록' ? '등록' : '변경'}되었습니다.`, 
                    ephemeral: true 
                });
            }
        }
        else if (command === '제거') {
            const partyToRemove = interaction.options.getString('파티제목');
            if (!guildParties[partyToRemove]) throw new Error("존재하지 않는 파티 제목입니다.");
            
            delete guildParties[partyToRemove];
            await savePartyData(guildId);
            await interaction.reply({ content: `파티 '${partyToRemove}'가 삭제되었습니다.`, ephemeral: true });
        }
        else if (command === '채널초기화') {
            const messages = await interaction.channel.messages.fetch({ limit: 100 });
            await Promise.all(messages.map(msg => 
                msg.delete().catch(e => console.error(`메시지 삭제 실패: ${e.message}`))
            ));
            const reply = await interaction.reply({ content: "채널이 초기화되었습니다.", ephemeral: true });
            setTimeout(() => reply.delete(), 5000);
        }
        else {
            throw new Error("알 수 없는 명령어입니다.");
        }

        // 파티 목록 메시지 업데이트
        await updatePartyMessages(interaction.channel, guildId);
        
    } catch (err) {
        await interaction.reply({ content: `오류: ${err.message}`, ephemeral: true });
    }
}

// 파티 목록 업데이트
async function updatePartyMessages(channel, guildId) {
    const guildParties = partyData.get(guildId) || {};
    const messages = await channel.messages.fetch({ limit: 50 });
    
    // 봇이 보낸 기존 메시지만 삭제
    await Promise.all(
        messages
            .filter(m => m.author.bot && !m.content.includes('클리어명단'))
            .map(msg => msg.delete().catch(console.error))
    );

    // 새 파티 목록 생성
    for (const [partyName, partyInfo] of Object.entries(guildParties)) {
        let content = `**${partyName}**\n\n`;
        content += partyInfo.members.size > 0 
            ? Array.from(partyInfo.members).join('\n') + '\n\n' 
            : "멤버 없음\n\n";
        content += `일정: ${partyInfo.schedule || "없음"}`;
        
        await channel.send(content);
    }
    
    // 데이터 저장 (업데이트 시마다)
    await savePartyData(guildId);
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

// 슬래시 커맨드 등록
async function registerCommands() {
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('클')
                .setDescription('레이드 클리어 정보 관리')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('등록')
                        .setDescription('클리어 정보 등록')
                        .addStringOption(option =>
                            option.setName('보스')
                                .setDescription('보스 이름')
                                .setRequired(true)
                                .addChoices(
                                    { name: '엑소', value: '엑소' },
                                    { name: '테라', value: '테라' }
                                ))
                        .addStringOption(option =>
                            option.setName('난이도')
                                .setDescription('난이도 선택')
                                .setRequired(true)
                                .addChoices(
                                    { name: '노말', value: '노말' },
                                    { name: '하드', value: '하드' },
                                    { name: '노말하드', value: '노말하드' }
                                ))
                        .addStringOption(option =>
                            option.setName('닉네임')
                                .setDescription('닉네임 (기본값: 본인 닉네임)')
                                .setRequired(false)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('제거')
                        .setDescription('클리어 정보 제거')
                        .addStringOption(option =>
                            option.setName('닉네임')
                                .setDescription('닉네임 (기본값: 본인 닉네임)')
                                .setRequired(false))),

            new SlashCommandBuilder()
                .setName('파티')
                .setDescription('파티 관리 시스템')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('생성')
                        .setDescription('새 파티 생성')
                        .addStringOption(option =>
                            option.setName('제목')
                                .setDescription('파티 제목')
                                .setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('제거')
                        .setDescription('파티 삭제')
                        .addStringOption(option =>
                            option.setName('파티제목')
                                .setDescription('삭제할 파티 제목')
                                .setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('채널초기화')
                        .setDescription('파티 채널 초기화'))
                .addSubcommandGroup(group =>
                    group
                        .setName('제목')
                        .setDescription('파티 제목 변경')
                        .addSubcommand(subcommand =>
                            subcommand
                                .setName('변경')
                                .setDescription('파티 제목 변경')
                                .addStringOption(option =>
                                    option.setName('기존제목')
                                        .setDescription('기존 파티 제목')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('새제목')
                                        .setDescription('새 파티 제목')
                                        .setRequired(true))))
                .addSubcommandGroup(group =>
                    group
                        .setName('목록')
                        .setDescription('파티 멤버 관리')
                        .addSubcommand(subcommand =>
                            subcommand
                                .setName('등록')
                                .setDescription('파티 멤버 추가')
                                .addStringOption(option =>
                                    option.setName('파티제목')
                                        .setDescription('파티 제목')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('이름')
                                        .setDescription('추가할 멤버 이름')
                                        .setRequired(true))
                                .addIntegerOption(option =>
                                    option.setName('위치')
                                        .setDescription('추가할 위치 (0부터 시작, 생략시 마지막에 추가)')
                                        .setRequired(false)))
                        .addSubcommand(subcommand =>
                            subcommand
                                .setName('제거')
                                .setDescription('파티 멤버 제거')
                                .addStringOption(option =>
                                    option.setName('파티제목')
                                        .setDescription('파티 제목')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('이름')
                                        .setDescription('제거할 멤버 이름')
                                        .setRequired(true))))
                .addSubcommandGroup(group =>
                    group
                        .setName('수정')
                        .setDescription('파티 멤버 정보 수정')
                        .addSubcommand(subcommand =>
                            subcommand
                                .setName('멤버')
                                .setDescription('파티 멤버 이름 수정')
                                .addStringOption(option =>
                                    option.setName('파티제목')
                                        .setDescription('파티 제목')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('기존이름')
                                        .setDescription('수정할 기존 멤버 이름')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('새이름')
                                        .setDescription('새 멤버 이름')
                                        .setRequired(true))))
                .addSubcommandGroup(group =>
                    group
                        .setName('일정')
                        .setDescription('파티 일정 관리')
                        .addSubcommand(subcommand =>
                            subcommand
                                .setName('등록')
                                .setDescription('파티 일정 등록')
                                .addStringOption(option =>
                                    option.setName('파티제목')
                                        .setDescription('파티 제목')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('내용')
                                        .setDescription('일정 내용')
                                        .setRequired(true)))
                        .addSubcommand(subcommand =>
                            subcommand
                                .setName('변경')
                                .setDescription('파티 일정 변경')
                                .addStringOption(option =>
                                    option.setName('파티제목')
                                        .setDescription('파티 제목')
                                        .setRequired(true))
                                .addStringOption(option =>
                                    option.setName('내용')
                                        .setDescription('새 일정 내용')
                                        .setRequired(true)))),

            new SlashCommandBuilder()
                .setName('알림초기화')
                .setDescription('보스 알림 시스템 초기화')
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        console.log(`[${getKoreanTime()}] 🔄 슬래시 커맨드 등록 시작...`);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(command => command.toJSON()) }
        );
        console.log(`[${getKoreanTime()}] ✅ 슬래시 커맨드 등록 완료`);
    } catch (error) {
        console.error(`[${getKoreanTime()}] ❌ 슬래시 커맨드 등록 실패:`, error);
    }
}

// 슬래시 커맨드 핸들러
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    try {
        // 클리어확인 채널 명령어 처리
        if (interaction.channel.name === CLEAR_CHANNEL_NAME && interaction.commandName === '클') {
            await handleClearCommand(interaction);
            return;
        }

        // 파티명단 채널 명령어 처리
        if (interaction.channel.name === PARTY_CHANNEL_NAME && interaction.commandName === '파티') {
            await handlePartyCommand(interaction);
            return;
        }

        // 보스알림 채널 명령어 처리
        if (interaction.channel.name !== BOSS_CHANNEL_NAME) {
            await interaction.reply({ content: "⚠️ 이 명령어는 #보스알림 채널에서만 사용 가능합니다.", ephemeral: true });
            return;
        }

        // 알림초기화 명령어 처리
        if (interaction.commandName === '알림초기화') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({ content: "⚠️ 이 명령어는 관리자만 사용할 수 있습니다.", ephemeral: true });
                return;
            }

            // 기존 봇 메시지 일괄 삭제
            const messages = await interaction.channel.messages.fetch();
            const deletionPromises = messages.filter(m => 
                m.author.bot && m.id !== interaction.id
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

            const bossMessage = await interaction.channel.send({ embeds: [embed]});
            await bossMessage.react(BOSS_ALERT_EMOJI);
            await bossMessage.react(DM_ALERT_EMOJI);
            
            // 시스템 재설정
            const guildId = interaction.guild.id;
            bossMessages.set(guildId, bossMessage);
            await saveMessageId(guildId, bossMessage.id);
            updateBossMessage(guildId, interaction.channel, bossMessage);
            
            await interaction.reply({ content: "✅ 알림 시스템이 초기화되었습니다.", ephemeral: true });
        }
    } catch (err) {
        console.error(`[${getKoreanTime()}] ❌ 명령어 처리 오류:`, err.message);
        await interaction.reply({ content: '명령어 처리 중 오류가 발생했습니다.', ephemeral: true });
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

// 클리어 메시지 초기화
async function initializeClearMessage(channel, guildId) {
    const savedMessageId = await getSavedClearMessageId(guildId);
    if (savedMessageId) {
        try {
            const clearMessage = await channel.messages.fetch(savedMessageId);
            await updateClearMessage(channel, guildId);
            return;
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ 저장된 클리어 메시지 불러오기 실패:`, err.message);
        }
    }
    await updateClearMessage(channel, guildId);
}

// 주간 초기화 스케줄러 추가
function setupWeeklyReset() {
    const now = new Date();
    const nextThursday = new Date();
    
    // 다음 목요일 계산 (4는 목요일을 의미, 0=일요일, 1=월요일, ..., 6=토요일)
    nextThursday.setDate(now.getDate() + ((4 - now.getDay() + 7) % 7));
    nextThursday.setHours(12, 0, 0, 0); // 오후 6시로 설정
    
    // 이미 지난 시간이면 다음 주로 설정
    if (nextThursday < now) {
        nextThursday.setDate(nextThursday.getDate() + 7);
    }
    
    const timeUntilReset = nextThursday - now;
    
    setTimeout(() => {
        resetAllClearData();
        // 매주 반복 설정
        setInterval(resetAllClearData, 7 * 24 * 60 * 60 * 1000);
    }, timeUntilReset);
}

async function resetAllClearData() {
    clearData.forEach((guildData, guildId) => {
        // 모든 클리어 데이터 초기화
        for (const boss of RAID_BOSSES) {
            for (const diff of DIFFICULTIES) {
                guildData[boss][diff].clear();
            }
        }
        
        // 클리어 채널 업데이트
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            const clearChannel = guild.channels.cache.find(c => c.name === CLEAR_CHANNEL_NAME);
            if (clearChannel) {
                // 기본 형태로 메시지 업데이트
                const defaultMessage = 
                    "**엑소니아 클리어명단**\n없음\n\n**테라곤 클리어명단**\n없음";
                
                // 기존 메시지 찾기
                clearChannel.messages.fetch({ limit: 10 }).then(messages => {
                    let clearMessage = messages.find(m => m.author.bot && m.content.includes('클리어명단'));
                    
                    if (clearMessage) {
                        // 기존 메시지 수정
                        clearMessage.edit(defaultMessage)
                            .then(() => console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버 클리어 명단 초기화 완료`))
                            .catch(err => console.error(`[${getKoreanTime()}] ❌ 메시지 수정 실패:`, err));
                    } else {
                        // 새 메시지 생성
                        clearChannel.send(defaultMessage)
                            .then(msg => saveClearMessageId(guildId, msg.id))
                            .then(() => console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버 클리어 명단 초기화 완료`))
                            .catch(err => console.error(`[${getKoreanTime()}] ❌ 메시지 생성 실패:`, err));
                    }
                }).catch(err => console.error(`[${getKoreanTime()}] ❌ 메시지 불러오기 실패:`, err));
                
                // 알림 메시지 보내기 (30분 후 삭제)
                clearChannel.send("🔄 **클리어 명단이 주간 초기화되었습니다!** 새로운 주도 화이팅! 💪")
                    .then(msg => {
                        console.log(`[${getKoreanTime()}] ⏳ 초기화 알림 메시지 전송 (30분 후 삭제 예정)`);
                        setTimeout(() => {
                            msg.delete()
                                .then(() => console.log(`[${getKoreanTime()}] 🗑️ 초기화 알림 메시지 삭제 완료`))
                                .catch(err => console.error(`[${getKoreanTime()}] ❌ 알림 메시지 삭제 실패:`, err));
                        }, 30 * 60 * 1000); // 30분 후 삭제
                    })
                    .catch(err => console.error(`[${getKoreanTime()}] ❌ 알림 메시지 전송 실패:`, err));
            }
        }
    });
    
    console.log(`[${getKoreanTime()}] 🔄 모든 서버 클리어 데이터 주간 초기화 완료`);
}



client.once('ready', async () => {
    await client.user.setActivity("거지 길드 봇, 제작 펄", { type: 0 });
    console.log(`[${getKoreanTime()}] ✅ ${client.user.tag} 봇이 온라인입니다!`);
    console.log(`[${getKoreanTime()}] 🟢 봇 시작 - ${new Date().toISOString()}`);
    
    try {
        // 기존 명령어 삭제
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('기존 명령어 삭제 완료');
        
        // 주간 초기화 설정
        setupWeeklyReset();
        // 오늘의 던전 스케줄러 설정 ← 이 부분에 추가
        setupDailyDungeonSchedule();
        await sendDailyDungeonMessage();
        
        updateIntervals.forEach(interval => clearInterval(interval));
        updateIntervals.clear();

        // 슬래시 커맨드 등록
        await registerCommands();

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

            // 파티 데이터 로드
            await loadPartyData(guildId);
                
            // 파티 데이터 초기화
            if (!partyData.has(guildId)) {
                partyData.set(guildId, {});
            }

            // 클리어 채널 초기화
            const clearChannel = guild.channels.cache.find(c => c.name === CLEAR_CHANNEL_NAME);
            if (clearChannel) {
                await initializeClearMessage(clearChannel, guildId);
            }
            
            // 파티 채널 초기화
            const partyChannel = guild.channels.cache.find(c => c.name === PARTY_CHANNEL_NAME);
            if (partyChannel) {
                await updatePartyMessages(partyChannel, guildId);
            }
        } catch (guildErr) {
            console.error(`[${getKoreanTime()}] ❌ ${guild.name} 서버 초기화 실패:`, guildErr.message);
            }
        }
    } catch (error) {
        console.error(`[${getKoreanTime()}] ❌ 봇 초기화 중 오류 발생:`, error);
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

    client.guilds.cache.forEach(async (guild) => {
        await savePartyData(guild.id).catch(console.error);
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


// 오늘의 던전 정보를 가져오는 함수
function getTodayDungeon() {
    const now = new Date();
    const day = now.getDay();
    
    const dungeons = [];
    
    if ([1, 3, 5].includes(day)) {
        dungeons.push({
            title: "금화 저장고",
            description: "몬스터와 맞서 싸우고 금화(골드, 경험치)를 쟁취하세요!",
            image: dungeonImages['금화 저장고']
        });
    }
    
    if ([2, 4, 6].includes(day)) {
        dungeons.push({
            title: "불안정한 제련소",
            description: "몬스터와 맞서 싸우고 미가공 강화 원석(정교한 강화석, 경험치)을 쟁취하세요!",
            image: dungeonImages['불안정한 제련소']
        });
    }
    
    if (day === 4) {
        dungeons.push({
            title: "레이드",
            description: "강력한 레이드 보스와의 전투에서 승리하여 전리품을 획득하세요!",
            image: dungeonImages['레이드']
        });
    }
    
    if (day === 0) {
        dungeons.push({
            title: "차원의 틈",
            description: "몬스터와 맞서 싸우고 디멘션 조각(열쇠, 경험치)을 쟁취하세요!",
            image: dungeonImages['차원의 틈']
        });
    }
    
    return dungeons;
}

// 오늘의 던전 메시지 생성 함수
async function sendDailyDungeonMessage() {
    const dungeons = getTodayDungeon();
    
    if (dungeons.length === 0) {
        console.log(`[${getKoreanTime()}] ⚠️ 오늘은 던전이 없습니다.`);
        return;
    }
    
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const dungeonChannel = guild.channels.cache.find(c => 
                c.name === DUNGEON_CHANNEL_NAME && 
                c.type === 0 &&
                c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
            );
            
            if (!dungeonChannel) continue;
            
            // 기존 봇 메시지 삭제
            const messages = await dungeonChannel.messages.fetch({ limit: 10 });
            await Promise.all(
                messages.filter(m => m.author.bot)
                    .map(msg => msg.delete().catch(console.error))
            );
            
            // 던전별로 개별 메시지 전송
            for (const dungeon of dungeons) {
                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle(`🏰 ${dungeon.title}`)
                    .setDescription(dungeon.description)
                    .setImage(dungeon.image)
                    .setFooter({ text: `갱신 시간: ${getKoreanTime()}` });
                
                await dungeonChannel.send({ embeds: [embed] });
            }
            
            console.log(`[${getKoreanTime()}] ✅ ${guild.name} 서버에 오늘의 던전 메시지 전송 완료`);
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ ${guild.name} 서버 던전 메시지 전송 실패:`, err.message);
        }
    }
}

// 매일 자정에 실행되도록 스케줄 설정
function setupDailyDungeonSchedule() {
    const now = new Date();
    const midnight = new Date();
    
    // 다음 자정 시간 설정 (오늘 자정이 지났으면 내일 자정)
    midnight.setHours(24, 0, 0, 0);
    
    const timeUntilMidnight = midnight - now;
    
    setTimeout(() => {
        sendDailyDungeonMessage();
        // 24시간마다 반복
        setInterval(sendDailyDungeonMessage, 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
    
    console.log(`[${getKoreanTime()}] ⏰ 오늘의 던전 스케줄러 설정 완료 (${midnight.toLocaleString('ko-KR')} 실행 예정)`);
}
