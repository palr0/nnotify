// 보스 메시지 업데이트 함수 전체 수정
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

            // 1분 전 알림 로직
            const timeUntilBoss = nextBoss.date.getTime() - now.getTime();
            
            if (timeUntilBoss <= 60000 && timeUntilBoss > 0) {
                // 역할 찾기 (채널의 guild에서 찾아야 함)
                const role = channel.guild.roles.cache.find(r => r.name === ALERT_ROLE_NAME);
                if (!role) {
                    console.error(`[${getKoreanTime()}] ❌ ${ALERT_ROLE_NAME} 역할을 찾을 수 없습니다.`);
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
                
                console.log(`[${getKoreanTime()}] 🔔 1분 전 알림 전송: ${nextBoss.boss}`);
            }
        } catch (err) {
            console.error(`[${getKoreanTime()}] ❌ 보스 메시지 업데이트 실패:`, err.message);
        }
    }, UPDATE_INTERVAL_MS);

    updateIntervals.set(guildId, intervalId);
}
