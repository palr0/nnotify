import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import './server.js'; // server.js는 ES 모듈 방식으로 작성되어야 함

const bossMessages = new Map();
const alertUsers = new Set();
const TOKEN = process.env.TOKEN;
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// getSavedMessageId와 saveMessageId 함수는 이미 정의되었으므로, 여기에 그대로 유지됩니다.

// updateBossMessage 함수 추가
async function updateBossMessage(channel, initialMessage) {
    let guildId = channel.guild?.id || channel.guildId;
    bossMessages.set(guildId, initialMessage);

    setInterval(async () => {
        const bosses = getUpcomingBosses();
        if (bosses.length === 0) return;

        const { boss: nextBoss, hour, minute } = bosses[0];
        const nextNextBoss = bosses[1] || { boss: '없음', hour: '-', minute: '-' };

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('보스 알림 받기')
            .setDescription('새로운 보스 리젠 알림이 1분 전 올라옵니다! 알림을 받고 싶다면, 아래 이모지를 클릭해 주세요.')
            .addFields(
                { name: "📢 다음 보스", value: `**${nextBoss}** (${hour}시 ${minute}분)`, inline: false },
                { name: "⏭️ 그 다음 보스", value: `**${nextNextBoss.boss}** (${nextNextBoss.hour}시 ${nextNextBoss.minute}분)`, inline: false }
            )
            .setFooter({ text: '🔔 클릭해서 알림을 받으세요!' });

        const bossMessage = bossMessages.get(guildId);
        if (bossMessage) {
            await bossMessage.edit({ embeds: [embed] }).catch(console.error);
        }
    }, 2000); // 2초마다 업데이트
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} 봇이 온라인입니다!`);
    client.guilds.cache.forEach(async (guild) => {
        const bossAlertChannel = guild.channels.cache.find(c => c.name === "보스알림");
        if (!bossAlertChannel) {
            console.error(`❌ '${guild.name}' 서버에서 '보스알림' 채널을 찾을 수 없습니다.`);
            return;
        }

        let bossMessage = null;

        try {
            const savedMessageId = await getSavedMessageId(guild.id);
            if (savedMessageId) {
                const fetched = await bossAlertChannel.messages.fetch(savedMessageId, { cache: false, force: true });
                if (fetched && fetched.edit) {
                    bossMessage = fetched;
                    bossMessages.set(guild.id, bossMessage);
                    console.log(`✅ ${guild.name} 서버 이전 메시지 불러오기 성공: ${fetched.id}`);
                }
            }
        } catch (err) {
            console.error(`⚠️ ${guild.name} 서버에서 메시지 불러오기 실패:`, err.message);
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
            bossMessages.set(guild.id, bossMessage);
            await saveMessageId(guild.id, bossMessage.id);
        }

        updateBossMessage(bossAlertChannel, bossMessage); // 여기에 추가된 함수 호출
    });
});

client.login(TOKEN);
