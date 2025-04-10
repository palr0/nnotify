import discord, asyncio, datetime, aiohttp
from discord.ext import commands, tasks
from flask import Flask
import threading
from config import TOKEN, JSONBIN_API_KEY, JSONBIN_BIN_ID

intents = discord.Intents.default()
intents.message_content = True
intents.reactions = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)
GUILD_ID = YOUR_GUILD_ID  # 디스코드 서버 ID를 여기에 넣어줘
CHANNEL_NAME = "보스알림"
ROLE_NAME = "보스알림"
MESSAGE_ID_KEY = "message_id"

headers = {
    "X-Master-Key": JSONBIN_API_KEY,
    "Content-Type": "application/json"
}

# 🔹 더미 웹서버 (Render용)
app = Flask(__name__)
@app.route("/")
def home():
    return "Bot is alive!"

def run_web():
    app.run(host="0.0.0.0", port=8080)

threading.Thread(target=run_web).start()


# 🔹 JSONBin에서 메시지 ID 가져오기
async def get_jsonbin():
    async with aiohttp.ClientSession() as session:
        async with session.get(f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}/latest", headers=headers) as res:
            data = await res.json()
            return data['record']

# 🔹 JSONBin에 메시지 ID 저장
async def update_jsonbin(message_id):
    payload = {MESSAGE_ID_KEY: message_id}
    async with aiohttp.ClientSession() as session:
        async with session.put(f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}", headers=headers, json=payload) as res:
            return await res.json()

# 🔹 /알림 슬래시 명령어
@bot.slash_command(guild_ids=[GUILD_ID], name="알림", description="보스 알림을 설정합니다.")
async def 알림(ctx):
    if ctx.channel.name != CHANNEL_NAME:
        await ctx.respond(f"이 명령어는 #{CHANNEL_NAME} 채널에서만 사용 가능합니다.", ephemeral=True)
        return

    await ctx.defer()
    existing = await get_jsonbin()
    message_id = existing.get(MESSAGE_ID_KEY)
    content = "🔔 보스 알림을 받으시려면 벨 이모지를 클릭해주세요!"

    if message_id:
        try:
            msg = await ctx.channel.fetch_message(int(message_id))
            await msg.edit(content=content)
            await ctx.respond("기존 알림 메시지를 수정했어요!", ephemeral=True)
            return
        except:
            pass  # 메시지가 삭제되었을 경우 새로 생성

    msg = await ctx.channel.send(content)
    await msg.add_reaction("🔔")
    await update_jsonbin(msg.id)
    await ctx.respond("새로운 알림 메시지를 등록했어요!", ephemeral=True)

# 🔹 이모지 반응 감지
@bot.event
async def on_raw_reaction_add(payload):
    if payload.emoji.name != "🔔":
        return
    guild = bot.get_guild(payload.guild_id)
    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    if not role:
        role = await guild.create_role(name=ROLE_NAME)

    member = guild.get_member(payload.user_id)
    if member and role not in member.roles:
        await member.add_roles(role)

@bot.event
async def on_raw_reaction_remove(payload):
    if payload.emoji.name != "🔔":
        return
    guild = bot.get_guild(payload.guild_id)
    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    member = guild.get_member(payload.user_id)
    if member and role in member.roles:
        await member.remove_roles(role)

# 🔹 보스 스케줄 타이머
@tasks.loop(seconds=60)
async def check_boss_schedule():
    now = datetime.datetime.now()
    channel = discord.utils.get(bot.get_all_channels(), name=CHANNEL_NAME)
    if not channel:
        return

    role = discord.utils.get(channel.guild.roles, name=ROLE_NAME)
    if not role:
        return

    schedule = {
        (0, 0): "그루트킹",
        (0, 30): "해적 선장",
    }

    if now.hour % 2 == 1:  # 홀수시
        schedule[(10, now.minute)] = "아절 브루트"
        schedule[(40, now.minute)] = "쿵푸"
        schedule[(50, now.minute)] = "세르칸"
    else:  # 짝수시
        schedule[(10, now.minute)] = "위더"
        schedule[(40, now.minute)] = "에이트"

    for (m, s), boss in schedule.items():
        if now.minute == m:
            alert = await channel.send(f"{role.mention} ⏰ **{boss}** 등장 1분 전입니다!")
            await asyncio.sleep(120)  # 1분 후 + 여유
            await alert.delete()

@bot.event
async def on_ready():
    print(f"✅ 로그인됨: {bot.user}")
    check_boss_schedule.start()

bot.run(TOKEN)
