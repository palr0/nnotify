import discord, asyncio, datetime, aiohttp
from discord.ext import commands, tasks
from config import TOKEN, JSONBIN_API_KEY, JSONBIN_BIN_ID
from boss_schedule import boss_schedule

intents = discord.Intents.default()
intents.message_content = True
intents.reactions = True
intents.members = True
bot = commands.Bot(command_prefix="/", intents=intents)

CHANNEL_NAME = "보스알림"
ROLE_NAME = "보스알림"

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    boss_alert.start()

@bot.slash_command(name="알림")
async def send_alert_command(ctx):
    if ctx.channel.name != CHANNEL_NAME:
        await ctx.respond("이 명령어는 보스알림 채널에서만 사용할 수 있습니다.", ephemeral=True)
        return

    await ctx.defer()
    message_data = await get_jsonbin_message()

    if message_data:
        try:
            msg = await ctx.channel.fetch_message(message_data["message_id"])
            await msg.edit(content="🛎️ 보스 알림을 받고 싶으면 이 메시지에 이모지를 눌러주세요!")
            await ctx.respond("기존 메시지를 수정했어요!", ephemeral=True)
        except:
            msg = await ctx.channel.send("🛎️ 보스 알림을 받고 싶으면 이 메시지에 이모지를 눌러주세요!")
            await update_jsonbin_message(msg.id)
            await ctx.respond("새 메시지를 생성했어요!", ephemeral=True)
    else:
        msg = await ctx.channel.send("🛎️ 보스 알림을 받고 싶으면 이 메시지에 이모지를 눌러주세요!")
        await update_jsonbin_message(msg.id)
        await ctx.respond("메시지를 생성했어요!", ephemeral=True)

    await msg.add_reaction("🔔")

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

def is_boss_time(now):
    hour = now.hour
    minute = now.minute
    minute_str = f"{minute:02d}"
    
    if minute_str in ["00", "30"]:
        return boss_schedule.get(f"{hour:02d}:{minute_str}")
    elif hour % 2 == 1:  # 홀수 시
        return boss_schedule.get(f"홀수:{minute_str}")
    elif hour % 2 == 0:  # 짝수 시
        return boss_schedule.get(f"짝수:{minute_str}")
    return None

@tasks.loop(seconds=30)
async def boss_alert():
    now = datetime.datetime.now()
    boss_name = is_boss_time(now + datetime.timedelta(minutes=1))
