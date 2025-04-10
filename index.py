import discord, asyncio, datetime, aiohttp, json
from discord.ext import commands, tasks
from discord import app_commands
from config import TOKEN, JSONBIN_API_KEY, JSONBIN_BIN_ID
from flask import Flask
import threading

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.members = True
intents.reactions = True

bot = commands.Bot(command_prefix="!", intents=intents)
tree = bot.tree

CHANNEL_NAME = "보스알림"
ROLE_NAME = "보스알림"
BOSS_SCHEDULE = {
    "그루트킹": lambda dt: dt.minute == 0,
    "해적 선장": lambda dt: dt.minute == 30,
    "아절 브루트": lambda dt: dt.hour % 2 == 1 and dt.minute == 10,
    "쿵푸": lambda dt: dt.hour % 2 == 1 and dt.minute == 40,
    "세르칸": lambda dt: dt.hour % 2 == 1 and dt.minute == 50,
    "위더": lambda dt: dt.hour % 2 == 0 and dt.minute == 10,
    "에이트": lambda dt: dt.hour % 2 == 0 and dt.minute == 40,
}

async def get_jsonbin_data():
    async with aiohttp.ClientSession() as session:
        async with session.get(f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}/latest",
                               headers={"X-Master-Key": JSONBIN_API_KEY}) as resp:
            data = await resp.json()
            return data['record']

async def update_jsonbin_data(data):
    async with aiohttp.ClientSession() as session:
        await session.put(f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}",
                          headers={"Content-Type": "application/json", "X-Master-Key": JSONBIN_API_KEY},
                          data=json.dumps(data))

def get_next_boss_times(now):
    upcoming = {}
    for name, rule in BOSS_SCHEDULE.items():
        for i in range(0, 25 * 60):  # 25시간 범위 검색
            future = now + datetime.timedelta(minutes=i)
            if rule(future):
                upcoming[name] = future
                break
    return dict(sorted(upcoming.items(), key=lambda x: x[1]))

def format_boss_message(now):
    upcoming = get_next_boss_times(now)
    lines = []
    for name, time in upcoming.items():
        remain = time - now
        mins, secs = divmod(int(remain.total_seconds()), 60)
        lines.append(f"**{name}**: {mins}분 {secs}초 후")
    return "\n".join(lines)

@tree.command(name="알림", description="보스 알림 메시지를 보냅니다.")
async def notify(interaction: discord.Interaction):
    await interaction.response.defer()
    channel = discord.utils.get(interaction.guild.text_channels, name=CHANNEL_NAME)
    if not channel:
        await interaction.followup.send("보스알림 채널을 찾을 수 없습니다.")
        return

    data = await get_jsonbin_data()
    message_id = data.get("message_id")

    now = datetime.datetime.now()
    content = format_boss_message(now)

    if message_id:
        try:
            msg = await channel.fetch_message(int(message_id))
            await msg.edit(content=content)
        except:
            msg = await channel.send(content)
            await update_jsonbin_data({"message_id": msg.id})
    else:
        msg = await channel.send(content)
        await update_jsonbin_data({"message_id": msg.id})

    await msg.add_reaction("🔔")
    await interaction.followup.send("보스 알림이 시작되었습니다!", ephemeral=True)

@bot.event
async def on_raw_reaction_add(payload):
    if payload.emoji.name != "🔔":
        return

    guild = bot.get_guild(payload.guild_id)
    member = guild.get_member(payload.user_id)
    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    if not role:
        role = await guild.create_role(name=ROLE_NAME)
    await member.add_roles(role)

@tasks.loop(seconds=1)
async def update_boss_message():
    await bot.wait_until_ready()
    now = datetime.datetime.now()
    data = await get_jsonbin_data()

    channel = discord.utils.get(bot.get_all_channels(), name=CHANNEL_NAME)
    if not channel or not data.get("message_id"):
        return

    try:
        msg = await channel.fetch_message(int(data["message_id"]))
        await msg.edit(content=format_boss_message(now))
    except:
        pass

@tasks.loop(seconds=30)
async def boss_alert_loop():
    await bot.wait_until_ready()
    now = datetime.datetime.now().replace(second=0, microsecond=0)
    alert_time = now + datetime.timedelta(minutes=1)

    for name, rule in BOSS_SCHEDULE.items():
        if rule(alert_time):
            channel = discord.utils.get(bot.get_all_channels(), name=CHANNEL_NAME)
            role = discord.utils.get(channel.guild.roles, name=ROLE_NAME)
            if not role:
                return

            msg = await channel.send(f"{role.mention} **{name}**가 곧 등장합니다!")
            await asyncio.sleep(60)
            await msg.delete()

# 더미 웹서버 (Render용)
app = Flask('')

@app.route('/')
def home():
    return "Bot is running"

def run_web():
    app.run(host='0.0.0.0', port=8080)

def keep_alive():
    t = threading.Thread(target=run_web)
    t.start()

# 봇 시작
keep_alive()
update_boss_message.start()
boss_alert_loop.start()
bot.run(TOKEN)
