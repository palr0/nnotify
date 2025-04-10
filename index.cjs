import discord, asyncio, datetime, aiohttp
from discord.ext import commands, tasks

TOKEN = 'YOUR_DISCORD_BOT_TOKEN'
JSONBIN_ID = 'YOUR_JSONBIN_ID'
JSONBIN_SECRET = 'YOUR_JSONBIN_SECRET'

intents = discord.Intents.all()
bot = commands.Bot(command_prefix='/', intents=intents)

BOSS_SCHEDULE = {
    (0, 0): '그루트킹', (0, 30): '해적 선장',
    (1, 10): '아절 브루트', (1, 40): '쿵푸', (1, 50): '세르칸',
    (2, 10): '위더', (2, 40): '에이트'
}

async def get_or_update_jsonbin(data=None):
    url = f"https://api.jsonbin.io/v3/b/{JSONBIN_ID}"
    headers = {'X-Master-Key': JSONBIN_SECRET, 'Content-Type': 'application/json'}
    async with aiohttp.ClientSession() as session:
        if data:
            async with session.put(url, headers=headers, json=data) as r: return await r.json()
        else:
            async with session.get(url, headers=headers) as r: return (await r.json())['record']

@bot.slash_command(name="알림", description="보스 알림 메시지를 재시작합니다.")
async def 알림(ctx, 옵션: str):
    if ctx.channel.name != "보스알림" or 옵션 != "재시작": return
    await ctx.defer()
    data = await get_or_update_jsonbin()
    msg_id = data.get("message_id")
    content = "👑 보스 알림에 참여하려면 이모지를 눌러주세요!"
    if msg_id:
        try:
            msg = await ctx.channel.fetch_message(int(msg_id))
            await msg.edit(content=content)
        except: msg = await ctx.channel.send(content)
    else:
        msg = await ctx.channel.send(content)
    await get_or_update_jsonbin({"message_id": str(msg.id)})
    await msg.add_reaction("👑")

@bot.event
async def on_raw_reaction_add(payload):
    if payload.emoji.name != "👑": return
    guild = bot.get_guild(payload.guild_id)
    role = discord.utils.get(guild.roles, name="보스알림")
    member = guild.get_member(payload.user_id)
    if role and member: await member.add_roles(role)

@tasks.loop(seconds=60)
async def boss_notifier():
    now = datetime.datetime.now()
    h, m = now.hour, now.minute
    boss = None
    if (h % 2, m) in BOSS_SCHEDULE:
        boss = BOSS_SCHEDULE[(h % 2, m)]
    if boss:
        for guild in bot.guilds:
            role = discord.utils.get(guild.roles, name="보스알림")
            channel = discord.utils.get(guild.text_channels, name="보스알림")
            if role and channel:
                msg = await channel.send(f"{role.mention} ⏰ `{boss}` 출현!")
                await asyncio.sleep(60)
                await msg.delete()

@bot.event
async def on_ready():
    boss_notifier.start()
    print(f"봇 시작됨: {bot.user}")

bot.run(TOKEN)
