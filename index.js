import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} 봇이 준비되었습니다.`);
  const channelName = '보스알림';

  // 매시 30분 → 해적 선장
  cron.schedule('30 * * * *', () => {
    sendBossAlert(channelName, '⏰ 보스 등장: **해적 선장**');
  });

  // 매 홀수시 10분 → 아절 브루트
  cron.schedule('10 1-23/2 * * *', () => {
    sendBossAlert(channelName, '⏰ 보스 등장: **아절 브루트**');
  });

  // 매 짝수시 10분 → 위더
  cron.schedule('10 0-22/2 * * *', () => {
    sendBossAlert(channelName, '⏰ 보스 등장: **위더**');
  });

  // 매 홀수시 40분 → 쿵푸
  cron.schedule('40 1-23/2 * * *', () => {
    sendBossAlert(channelName, '⏰ 보스 등장: **쿵푸**');
  });

  // 매 홀수시 50분 → 세르칸
  cron.schedule('50 1-23/2 * * *', () => {
    sendBossAlert(channelName, '⏰ 보스 등장: **세르칸**');
  });

  // 매 짝수시 40분 → 에이트
  cron.schedule('40 0-22/2 * * *', () => {
    sendBossAlert(channelName, '⏰ 보스 등장: **에이트**');
  });
});

async function sendBossAlert(channelName, message) {
  const guilds = client.guilds.cache;

  for (const [guildId, guild] of guilds) {
    const channel = guild.channels.cache.find(
      (ch) => ch.name === channelName && ch.isTextBased()
    );
    if (channel) {
      try {
        await channel.send(message);
        console.log(`[알림 전송됨] ${guild.name}: ${message}`);
      } catch (err) {
        console.error(`[오류] ${guild.name} - ${err.message}`);
      }
    } else {
      console.warn(`[채널 없음] ${guild.name}에 '${channelName}' 채널이 없습니다.`);
    }
  }
}

client.login(process.env.TOKEN);
