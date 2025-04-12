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
    { hourType: '홀수', minute: 10, boss: '위더' },
    { hourType: '짝수', minute: 10, boss: '아절 브루트' },
    { hourType: '홀수', minute: 40, boss: '에이트' },
    { hourType: '짝수', minute: 40, boss: '쿵푸' },
    { hourType: '짝수', minute: 50, boss: '세르칸' }
];

// 한국 시간 형식으로 변환 (출력용으로 6시간 뺀 시간 표시)
function getKoreanTime(date = new Date()) {
    const adjustedDate = new Date(date.getTime() - 6 * 60 * 60 * 1000);
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
            const displayDate = new Date(bossDate.getTime() - 6 * 60 * 60 * 1000);
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

// ... (나머지 코드는 동일하게 유지)

// 보스 메시지 업데이트 함수
async function updateBossMessage(guildId, channel, initialMessage) {
    // 기존 인터벌 제거
    if (updateIntervals.has(guildId)) {
        clearInterval(updateIntervals.get(guildId));
    }

    // 새 인터벌 설정
    const intervalId = setInterval(async () => {
        try {
            const now = new Date();
            const bosses = getUpcomingBosses(now);
            if (bosses.length === 0) return;

            const nextBoss = bosses[0];
            const nextNextBoss = bosses[1] || { boss: '없음', timeStr: '-' };

            // 1분 전 알림 로직 (실제 시간 비교)
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

                const alertEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('⚠️ 보스 알림 ⚠️')
                    .setDescription(`**${nextBoss.boss}**가 1분 후에 출현합니다!`)
                    .addFields(
                        { name: "출현 시간", value: nextBoss.timeStr, inline: true },
                        { name: "위치", value: "보스 출현 지역", inline: true }
                    );

                await channel.send({ 
                    content: `<@&${role.id}>`,
                    embeds: [alertEmbed],
                    allowedMentions: { roles: [role.id] }
                });
                
                console.log(`[${getKoreanTime()}] 🔔 1분 전 알림 전송: ${nextBoss.boss} (${membersWithRole}명에게 전송)`);
            }

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
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ 보스 메시지 업데이트 실패:`, err.message);
        }
    }, UPDATE_INTERVAL_MS);

    updateIntervals.set(guildId, intervalId);
}

// ... (나머지 코드는 동일하게 유지)
