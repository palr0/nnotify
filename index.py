import discord, asyncio, datetime, aiohttp, threading
from flask import Flask
from discord.ext import commands, tasks
from config import TOKEN, JSONBIN_API_KEY, JSONBIN_BIN_ID

intents = discord.Intents.default()
intents.message_content = True
intents.reactions = True
intents.guilds = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)
CHANNEL_NAME = "보스알림"
ROLE_NAME = "보스알림"
ALERT_TIMES = {
    "00:00": "그루트킹",
    "00:30": "해적 선장",
    "홀수_10": "아절 브루트",
    "홀수_40": "쿵푸",
    "홀수_50": "세르칸",
    "짝수_10": "위더",
    "짝수_40": "에이트",
}
EMOJIS = ["🌳", "🏴‍☠️", "🧟", "🥋", "🐍", "💀", "🦑"]

app = Flask("")

@app.route("/")

def home():
    return "Bot is alive!"

def run():
    app.run(host="0.0.0.0", port=8080)

async def update_or_create_message(channel):
    url = f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}"
    headers = {
        "X-Master-Key": JSONBIN_API_KEY,
        "Content-Type": "application/json"
    }

    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers) as res:
            data = await res.json()
            message_id = data['record'].get('message_id')

        if message_id:
            try:
                msg = await channel.fetch_message(int(message_id))
                await msg.edit(content="보스 알림을 받을 이모지를 눌러주세요!")
                return msg
            except discord.NotFound:
                pass

        msg = await channel.send("보스 알림을 받을 이모지를 눌러주세요!")
        async with session.put(url, headers=headers, json={"message_id": msg.id}):
            pass
        return msg

@bot.slash_command(name="알림", description="보스 알림 메시지를 설정합니다.")
async def 알림(ctx):
    if ctx.channel.name != CHANNEL_NAME:
        await ctx.respond(f"이 명령어는 #{CHANNEL_NAME} 채널에서만 사용 가능합니다.", ephemeral=True)
        return

    msg = await update_or_create_message(ctx.channel)

    for emoji in EMOJIS:
        await msg.add_reaction(emoji)

    await ctx.respond("보스 알림 메시지를 설정했습니다.", ephemeral=True)

@bot.event
async def on_raw_reaction_add(payload):
    if payload.member.bot:
        return
    if str(payload.emoji) not in EMOJIS:
        return

    guild = bot.get_guild(payload.guild_id)
    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    if not role:
        role = await guild.create_role(name=ROLE_NAME)

    member = payload.member
    await member.add_roles(role)

@bot.event
async def on_raw_reaction_remove(payload):
    guild = bot.get_guild(payload.guild_id)
    member = guild.get_member(payload.user_id)
    if not member:
        return

    if str(payload.emoji) not in EMOJIS:
        return

    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    if role:
        await member.remove_roles(role)

def should_alert(now: datetime.datetime):
    key = now.strftime("%M")
    hour = now.hour
    if key == "00":
        return "00:00", ALERT_TIMES["00:00"]
    elif key == "30":
        return "00:30", ALERT_TIMES["00:30"]
    elif key == "10":
        if hour % 2 == 1:
            return "홀수_10", ALERT_TIMES["홀수_10"]
        else:
            return "짝수_10", ALERT_TIMES["짝수_10"]
    elif key == "40":
        if hour % 2 == 1:
            return "홀수_40", ALERT_TIMES["홀수_40"]
        else:
            return "짝수_40", ALERT_TIMES["짝수_40"]
    elif key == "50" and hour % 2 == 1:
        return "홀수_50", ALERT_TIMES["홀수_50"]
    return None, None

@tasks.loop(seconds=30)
async def boss_alert_loop():
    now = datetime.datetime.now()
    delta = datetime.timedelta(minutes=1)
    alert_key, boss_name = should_alert(now)
    if not boss_name:
        return

    guilds = bot.guilds
    for guild in guilds:
        role = discord.utils.get(guild.roles, name=ROLE_NAME)
        if not role:
            continue

        channel = discord.utils.get(guild.text_channels, name=CHANNEL_NAME)
        if not channel:
            continue

        embed = discord.Embed(
            title="보스 등장 알림",
            description=f"{boss_name}이(가) 곧 등장합니다!",
            color=discord.Color.red(),
            timestamp=now
        )
        alert_msg = await channel.send(content=role.mention, embed=embed)

        await asyncio.sleep(60)  # 1분 대기
        await alert_msg.delete()

@bot.event
async def on_ready():
    print(f"봇 시작됨: {bot.user}")
    boss_alert_loop.start()
    
threading.Thread(target=run).start()

bot.run(TOKEN)
