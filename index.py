import discord, asyncio, datetime, aiohttp, os
from discord.ext import commands, tasks
from config import TOKEN, JSONBIN_API_KEY, JSONBIN_BIN_ID

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.members = True
intents.reactions = True

bot = commands.Bot(command_prefix="!", intents=intents)
TREE = bot.tree

BOSS_CHANNEL_NAME = "보스알림"
ROLE_NAME = "보스알림"
BELL_EMOJI = "🔔"
MESSAGE_KEY = "boss_alert_message_id"

BOSS_SCHEDULE = {
    "every_hour": {0: "그루트킹", 30: "해적 선장"},
    "odd_hours": {10: "아절 브루트", 40: "쿵푸", 50: "세르칸"},
    "even_hours": {10: "위더", 40: "에이트"}
}

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    try:
        synced = await TREE.sync()  # 글로벌 커맨드 등록
        print(f"Slash commands synced: {len(synced)}")
    except Exception as e:
        print(f"Error syncing commands: {e}")
    schedule_alerts.start()
    start_webserver()

async def get_jsonbin_data():
    async with aiohttp.ClientSession() as session:
        headers = {"X-Master-Key": JSONBIN_API_KEY}
        async with session.get(f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}", headers=headers) as r:
            res = await r.json()
            return res["record"]

async def update_jsonbin_data(data):
    async with aiohttp.ClientSession() as session:
        headers = {
            "X-Master-Key": JSONBIN_API_KEY,
            "Content-Type": "application/json"
        }
        async with session.put(f"https://api.jsonbin.io/v3/b/{JSONBIN_BIN_ID}", headers=headers, json=data) as r:
            return await r.json()

@TREE.command(name="알림", description="보스알림 메세지를 생성하거나 업데이트합니다.")
async def 알림(interaction: discord.Interaction):
    await interaction.response.defer()

    channel = discord.utils.get(interaction.guild.text_channels, name=BOSS_CHANNEL_NAME)
    if not channel:
        await interaction.followup.send("보스알림 채널을 찾을 수 없습니다.")
        return

    data = await get_jsonbin_data()
    msg_id = data.get(MESSAGE_KEY)

    content = "🔔 이 메시지에 반응하면 '보스알림' 역할이 부여됩니다."

    if msg_id:
        try:
            old_msg = await channel.fetch_message(int(msg_id))
            await old_msg.edit(content=content)
            await interaction.followup.send("메시지를 업데이트했어요.")
        except:
            new_msg = await channel.send(content)
            await new_msg.add_reaction(BELL_EMOJI)
            data[MESSAGE_KEY] = str(new_msg.id)
            await update_jsonbin_data(data)
            await interaction.followup.send("새 메시지를 보냈어요.")
    else:
        new_msg = await channel.send(content)
        await new_msg.add_reaction(BELL_EMOJI)
        data[MESSAGE_KEY] = str(new_msg.id)
        await update_jsonbin_data(data)
        await interaction.followup.send("알림 메시지를 생성했어요.")

@bot.event
async def on_raw_reaction_add(payload):
    if str(payload.emoji) != BELL_EMOJI:
        return

    guild = bot.get_guild(payload.guild_id)
    if not guild:
        return

    data = await get_jsonbin_data()
    if str(payload.message_id) != data.get(MESSAGE_KEY):
        return

    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    if not role:
        role = await guild.create_role(name=ROLE_NAME)

    member = guild.get_member(payload.user_id)
    if member and role not in member.roles:
        await member.add_roles(role)

@bot.event
async def on_raw_reaction_remove(payload):
    if str(payload.emoji) != BELL_EMOJI:
        return

    guild = bot.get_guild(payload.guild_id)
    if not guild:
        return

    data = await get_jsonbin_data()
    if str(payload.message_id) != data.get(MESSAGE_KEY):
        return

    role = discord.utils.get(guild.roles, name=ROLE_NAME)
    member = guild.get_member(payload.user_id)
    if member and role in member.roles:
        await member.remove_roles(role)

@tasks.loop(seconds=30)
async def schedule_alerts():
    now = datetime.datetime.now()
    minute = now.minute
    hour = now.hour

    boss_name = None
    if minute == 59 or minute == 29 or minute == 9 or minute == 39 or minute == 49:  # 1분 전 감지
        next_min = (minute + 1) % 60
        if next_min in BOSS_SCHEDULE["every_hour"]:
            boss_name = BOSS_SCHEDULE["every_hour"][next_min]
        elif hour % 2 == 1 and next_min in BOSS_SCHEDULE["odd_hours"]:
            boss_name = BOSS_SCHEDULE["odd_hours"][next_min]
        elif hour % 2 == 0 and next_min in BOSS_SCHEDULE["even_hours"]:
            boss_name = BOSS_SCHEDULE["even_hours"][next_min]

        if boss_name:
            for guild in bot.guilds:
                role = discord.utils.get(guild.roles, name=ROLE_NAME)
                channel = discord.utils.get(guild.text_channels, name=BOSS_CHANNEL_NAME)
                if role and channel:
                    msg = await channel.send(f"{role.mention} ⏰ **{boss_name}** 1분 후 스폰됩니다!")
                    await asyncio.sleep(60)
                    await msg.delete()

# 더미 웹서버
def start_webserver():
    from aiohttp import web

    async def handler(request):
        return web.Response(text="Bot is running!")

    app = web.Application()
    app.router.add_get("/", handler)
    port = int(os.environ.get("PORT", 8080))
    runner = web.AppRunner(app)

    async def run_app():
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", port)
        await site.start()

    bot.loop.create_task(run_app())

bot.run(TOKEN)
