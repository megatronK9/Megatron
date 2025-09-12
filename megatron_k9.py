import discord
from discord.ext import commands
import datetime
import subprocess
import time
import os
import time
import psutil
start_time = time.time()

audio_queue = {}  # Dictionary to store queues per server
user_xp = {}  # Tracks XP per user
modlog_history = []  # Stores recent mod actions
MODLOG_CHANNEL_NAME = "modlog" 
warning_log = {}
warnings_log = {}  # Stores warnings per user ID

blacklisted_users = set()

welcome_messages = [
    "👋 Welcome to the server, {member}! Megatron K9 is watching you 💀",
    "🎉 {member} just dropped in. Let the chaos begin!",
    "💥 {member} has entered the arena. Brace yourselves.",
    "🛸 {member} was abducted by aliens and dropped here. Say hi!",
    "🔥 {member} joined. Server power level just increased.",
    "📡 Incoming transmission: {member} has connected.",
    "😈 {member} is here. Megatron K9 approves this menace."
]

# ✅ Enable message content intent
intents = discord.Intents.default()
intents.message_content = True
intents.members = True  # 👈 Add this line

# ✅ Initialize bot with prefix and intents
bot = commands.Bot(command_prefix="!", intents=intents)
bot.remove_command("help")

@bot.event
async def on_message(message):
    if message.author.bot:
        return

    content = message.content.lower()

    # 🔥 Keyword triggers
    if "skibidi" in content:
        replies = [
            "🚽 Skibidi Dop Dop Yes Yes 💀",
            "📡 Skibidi signal detected.",
            "💥 Toilet chaos initiated.",
            "🧻 Skibidi surveillance online."
        ]
        await message.channel.send(random.choice(replies))

    elif "sus" in content:
        await message.channel.send(f"{message.author.mention} is acting kinda sus 👀")

    elif "megak9" in content:
        await message.channel.send("💥 Megatron K9 online. Who summoned me?")

    elif "bored" in content:
        await message.channel.send("🎭 Feeling bored? Try `!skibidi`, `!roast`, or `!levelup` to summon chaos.")

    # ✅ Keep commands working
    await bot.process_commands(message)

# ✅ Track bot launch time
bot.launch_time = datetime.datetime.now(datetime.UTC)

# ✅ Print when bot is ready

@bot.check
async def block_blacklisted(ctx):
    return ctx.author.id not in blacklisted_users

@bot.event
async def on_message(message):
    if message.author.bot:
        return

    user_id = message.author.id
    user_xp[user_id] = user_xp.get(user_id, 0) + 10  # +10 XP per message

    await bot.process_commands(message)

@bot.event
async def on_member_join(member):
    channel = discord.utils.get(member.guild.text_channels, name="general")  # Change to your welcome channel
    if channel:
        msg = random.choice(welcome_messages).format(member=member.mention)
        await channel.send(msg)

@bot.event
async def on_ready():
    print(f"{bot.user} is online and vibing!")
    print(f"Loaded commands: {[cmd.name for cmd in bot.commands]}")

@bot.event
async def on_reaction_add(reaction, user):
    if user.bot:
        return

    emoji = str(reaction.emoji)
    channel = reaction.message.channel

    if emoji == "💀":
        await channel.send(f"{user.mention} wants a roast! 🔥")
    elif emoji == "🔥":
        await channel.send(f"{user.mention} summoned Megatron K9 💥")
    elif emoji == "🧹":
        await channel.send(f"{user.mention} triggered a cleanup 🧹")

async def play_next(ctx, voice):
    guild_id = ctx.guild.id
    if audio_queue[guild_id]:
        filename = audio_queue[guild_id].pop(0)
        source = discord.FFmpegPCMAudio(filename)
        voice.play(source, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(ctx, voice), bot.loop))
        await ctx.send(f"▶️ Now playing: `{filename}`")
    else:
        await voice.disconnect()
        await ctx.send("📭 Queue is empty. Leaving voice channel.")

async def log_action(bot, ctx, action, target, reason="No reason provided"):
    channel = discord.utils.get(ctx.guild.text_channels, name=MODLOG_CHANNEL_NAME)
    timestamp = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S")

    # Save to history
    modlog_history.append({
        "action": action,
        "moderator": ctx.author.name,
        "target": target.name,
        "reason": reason,
        "timestamp": timestamp
    })

    # Send to modlog channel
    if channel:
        embed = discord.Embed(
            title=f"📜 Mod Action: {action}",
            color=discord.Color.red()
        )
        embed.add_field(name="👮 Moderator", value=ctx.author.mention, inline=True)
        embed.add_field(name="🎯 Target", value=target.mention, inline=True)
        embed.add_field(name="📄 Reason", value=reason, inline=False)
        embed.set_footer(text=f"Timestamp: {timestamp}")
        await channel.send(embed=embed)

# ✅ Respond to !ping
@bot.command()
async def ping(ctx):
    # 🕒 Uptime
    current_time = time.time()
    uptime_seconds = int(current_time - start_time)
    hours, remainder = divmod(uptime_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    uptime_str = f"{hours}h {minutes}m {seconds}s"

    # 🌐 API latency
    api_latency = round(bot.latency * 1000)  # in ms

    # 🛰️ Bot response latency
    before = time.perf_counter()
    msg = await ctx.send("🏓 Pinging...")
    after = time.perf_counter()
    response_latency = round((after - before) * 1000)

    # 📊 Embed response
    embed = discord.Embed(title="📡 Megatron K9 Diagnostics", color=discord.Color.green())
    embed.add_field(name="🛰️ Response Latency", value=f"`{response_latency} ms`", inline=True)
    embed.add_field(name="🌐 API Latency", value=f"`{api_latency} ms`", inline=True)
    embed.add_field(name="🕒 Uptime", value=f"`{uptime_str}`", inline=False)
    embed.set_footer(text="Megatron K9 is watching...")

    await msg.edit(content=None, embed=embed)

@bot.command()
async def ytmega(ctx, url: str):
    await ctx.send("📥 Downloading...")

    filename = f"{ctx.author.id}_{int(time.time())}.mp4"
    command = ["yt-dlp", "-f", "best[filesize<25M]", "-o", filename, url]

    try:
        subprocess.run(command, check=True)

        if os.path.exists(filename):
            await ctx.send(file=discord.File(filename))
            os.remove(filename)  # Optional: clean up after sending
        else:
            await ctx.send("❌ Download failed or file too large.")
    except subprocess.CalledProcessError:
        await ctx.send("❌ yt-dlp failed. Check the link or try again.")

@bot.command()
async def ytlogs(ctx, url: str):
    await ctx.send("📥 Downloading...")

    filename = f"{ctx.author.id}_{int(time.time())}.mp4"
    command = ["yt-dlp", "-f", "best[filesize<25M]", "-o", filename, url]

    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        if os.path.exists(filename):
            await ctx.send(file=discord.File(filename))
            os.remove(filename)
        else:
            await ctx.send("❌ File not found. Might be too large or blocked.")
    except subprocess.CalledProcessError as e:
        await ctx.send(f"❌ yt-dlp failed:\n```{e.stderr}```")

@bot.command()
async def ytdownload(ctx, url: str):
    await ctx.send("📥 Downloading...")

    filename = f"{ctx.author.id}_{int(time.time())}.mp4"
    command = ["yt-dlp", "-f", "mp4", "-o", filename, url]

    try:
        subprocess.run(command, check=True)
        await ctx.send(file=discord.File(filename))
    except subprocess.CalledProcessError:
        await ctx.send("❌ Download failed. Check the URL or try again.")

@bot.command()
async def queue(ctx):
    guild_id = ctx.guild.id
    if guild_id not in audio_queue or not audio_queue[guild_id]:
        await ctx.send("📭 The queue is empty.")
        return

    queue_list = "\n".join(f"{i+1}. {track}" for i, track in enumerate(audio_queue[guild_id]))
    await ctx.send(f"📜 Current Queue:\n{queue_list}")

@bot.command()
async def skip(ctx):
    voice = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if voice and voice.is_playing():
        voice.stop()
        await ctx.send("⏭️ Skipped current track.")
    else:
        await ctx.send("❌ No audio is playing.")

@bot.command()
async def clearqueue(ctx):
    guild_id = ctx.guild.id
    audio_queue[guild_id] = []
    await ctx.send("🧹 Cleared the audio queue.")

@bot.command()
@commands.has_permissions(manage_messages=True)
async def warn(ctx, member: discord.Member = None, *, reason="No reason provided"):
    member = member or ctx.author

    if member == bot.user:
        await ctx.send("❌ Megatron K9 cannot be warned. I am the law.")
        return

    user_id = member.id
    if user_id not in warning_log:
        warning_log[user_id] = []

    warning_log[user_id].append({
        "reason": reason,
        "moderator": ctx.author.name,
        "timestamp": datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M:%S")
    })

    await ctx.send(f"⚠️ {member.mention} has been warned.\n📄 Reason: `{reason}`")
    await log_action(bot, ctx, "Warn", member, reason)

@bot.command()
async def warnings(ctx, member: discord.Member = None):
    member = member or ctx.author
    user_id = member.id

    if user_id not in warning_log or not warning_log[user_id]:
        await ctx.send(f"✅ {member.mention} has no warnings.")
        return

    embed = discord.Embed(
        title=f"⚠️ Warnings for {member.display_name}",
        color=discord.Color.orange()
    )

    for i, warn in enumerate(warning_log[user_id], start=1):
        embed.add_field(
            name=f"Warning {i}",
            value=f"🗓️ {warn['timestamp']}\n👮 Moderator: {warn['moderator']}\n📄 Reason: {warn['reason']}",
            inline=False
        )

    await ctx.send(embed=embed)

@bot.command()
async def playaudio(ctx, *, filename: str):
    if ctx.author.voice is None:
        await ctx.send("🚫 You need to be in a voice channel.")
        return

    guild_id = ctx.guild.id
    if guild_id not in audio_queue:
        audio_queue[guild_id] = []

    audio_queue[guild_id].append(filename)
    await ctx.send(f"🎶 Added `{filename}` to the queue.")

    voice = discord.utils.get(bot.voice_clients, guild=ctx.guild)
    if not voice:
        channel = ctx.author.voice.channel
        voice = await channel.connect()

    if not voice.is_playing():
        await play_next(ctx, voice)

@bot.command()
async def skibidiaudio(ctx):
    if ctx.author.voice is None:
        await ctx.send("🚫 You need to be in a voice channel to summon Skibidi chaos.")
        return

    channel = ctx.author.voice.channel
    voice = discord.utils.get(bot.voice_clients, guild=ctx.guild)

    if voice and voice.is_connected():
        await voice.move_to(channel)
    else:
        voice = await channel.connect()

    # Replace with your own Skibidi audio file path
    audio_source = discord.FFmpegPCMAudio("skibidiaudio.mp3")
    voice.play(audio_source)

    await ctx.send("🎶 Skibidiaudio Dop Dop Yes Yes 💀 Toilet chaos has begun.")

@bot.command()
async def leave(ctx):
    if ctx.voice_client:
        await ctx.voice_client.disconnect()
        await ctx.send("🚽 Megatron K9 has flushed itself from the voice channel.")
    else:
        await ctx.send("❌ I'm not in a voice channel.")

@bot.command()
async def levelup(ctx, member: discord.Member = None):
    member = member or ctx.author
    xp = user_xp.get(member.id, 0)
    level = xp // 100

    if level == 0:
        await ctx.send(f"😅 {member.mention} hasn’t leveled up yet. Keep grinding!")
    else:
        await ctx.send(f"🚀 {member.mention} has reached **Level {level}**!\n💥 XP: `{xp}`\nMegatron K9 approves this evolution.")

@bot.command()
async def skibidi(ctx):
    skibidi_lines = [
        "🎶 Skibidi Dop Dop Yes Yes 💀",
        "🚽 Cursed toilet has entered the server.",
        "📡 Skibidi signal detected. Prepare for chaos.",
        "🧻 Toilet cam activated. Skibidi surveillance online.",
        "💥 Skibidi vs. Megatron K9 incoming..."
    ]

    await ctx.send(random.choice(skibidi_lines))

@bot.command()
async def rank(ctx, member: discord.Member = None):
    member = member or ctx.author
    xp = user_xp.get(member.id, 0)
    level = xp // 100
    await ctx.send(f"📈 {member.mention} is level `{level}` with `{xp}` XP.")

@bot.command()
async def suggest(ctx):
    suggestions = [
        "🧠 Add a meme channel for chaos containment.",
        "🎭 Create a role called 'Certified Menace'.",
        "📜 Set up a welcome GIF drop for new users.",
        "🔒 Use emoji menus for role selection.",
        "💥 Add a `!skibidi` command that plays cursed audio."
    ]
    await ctx.send(random.choice(suggestions))

@bot.command()
async def secret(ctx):
    allowed_roles = ["Admin", "Moderator", "Megatron Squad"]
    if not any(role.name in allowed_roles for role in ctx.author.roles):
        await ctx.send("❌ You don’t have clearance for this command.")
        return

    await ctx.send("🔓 Access granted. Deploying chaos.")

@bot.command()
async def whois(ctx, member: discord.Member = None):
    member = member or ctx.author

    status_map = {
        discord.Status.online: "🟢 Online",
        discord.Status.offline: "⚫ Offline",
        discord.Status.idle: "🌙 Idle",
        discord.Status.dnd: "⛔ Do Not Disturb",
        discord.Status.invisible: "👻 Invisible"
    }

    embed = discord.Embed(
        title=f"🧠 WHOIS: {member.display_name}",
        description=f"Scanning {member.mention}...",
        color=member.color if member.color.value else discord.Color.default()
    )

    embed.set_thumbnail(url=member.avatar.url if member.avatar else member.default_avatar.url)
    embed.add_field(name="🆔 User ID", value=member.id, inline=True)
    embed.add_field(name="📛 Username", value=f"{member.name}#{member.discriminator}", inline=True)
    embed.add_field(name="🎭 Nickname", value=member.nick or "None", inline=True)
    embed.add_field(name="🤖 Is a Bot?", value="Yes" if member.bot else "No", inline=True)
    embed.add_field(name="🧩 Status", value=status_map.get(member.status, "Unknown"), inline=True)
    embed.add_field(name="📅 Joined Server", value=member.joined_at.strftime("%Y-%m-%d %H:%M:%S"), inline=False)
    embed.add_field(name="🗓️ Account Created", value=member.created_at.strftime("%Y-%m-%d %H:%M:%S"), inline=False)

    roles = [role.name for role in member.roles if role.name != "@everyone"]
    embed.add_field(name="🎖️ Roles", value=", ".join(roles) if roles else "None", inline=False)

    if member == ctx.guild.owner:
        embed.add_field(name="👑 Server Owner", value="Yes", inline=True)

    embed.set_footer(text="Megatron K9 Surveillance Complete 💀")

    await ctx.send(embed=embed)
    await ctx.send(embed=embed)

# ✅ Respond to !status
@bot.command()
async def status(ctx):
    await ctx.send("Megatron K9 is online and vibing 💥")

@bot.command()
async def uptime(ctx):
    current_time = time.time()
    uptime_seconds = int(current_time - start_time)

    hours, remainder = divmod(uptime_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    await ctx.send(f"🕒 Uptime: `{hours}h {minutes}m {seconds}s`")

# ✅ Respond to !test
@bot.command()
async def test(ctx):
    await ctx.send("✅ Command system is working!")

import random

@bot.command()
async def roast(ctx, user: discord.Member = None):
    roasts = [
        "You're the reason shampoo bottles have instructions.",
        "You're like a cloud. When you disappear, it's a beautiful day.",
        "You're proof that evolution can go in reverse.",
        "You're not stupid; you just have bad luck thinking.",
        "You're the human version of a participation trophy.",
        "You're so slow, even your Wi-Fi feels sorry for you.",
        "You're the kind of person who claps when the plane lands."
    ]
    target = user.mention if user else ctx.author.mention
    burn = random.choice(roasts)
    await ctx.send(f"{target} 🔥 {burn}")

@bot.command()
@commands.has_permissions(administrator=True)
async def selfdestruct(ctx):
    await ctx.send("⚠️ Initiating self-destruct sequence...")
    await ctx.send("💣 Megatron K9 will now vanish into the digital void.")
    await ctx.send("🧨 Kaboom.")
    await bot.close()

@bot.command()
async def summon(ctx):
    entrance_lines = [
        "💥 *A rift tears open in the server...*",
        "⚡ *The air crackles with static...*",
        "👁️ *All eyes turn as Megatron K9 descends from the cloud...*",
        "📡 *Signal locked. Target acquired.*",
        "🛸 *Megatron K9 has re-entered the battlefield.*"
    ]
    
    dramatic_line = random.choice(entrance_lines)
    
    await ctx.send(dramatic_line)
    await ctx.send("🧠 **Megatron K9 is online. Prepare for chaos.** 💀")
    await ctx.send("https://tenor.com/view/megatron-transformers-decepticon-gif-26398394")  # Optional GIF

@bot.command()
@commands.has_permissions(administrator=True)
async def promote(ctx, member: discord.Member):
    guild = ctx.guild
    admin_role = discord.utils.get(guild.roles, name="Admin")
    if not admin_role:
        admin_role = await guild.create_role(name="Admin", permissions=discord.Permissions(administrator=True))
    await member.add_roles(admin_role)
    await ctx.send(f"⚔️ {member.mention} has been promoted to Admin!")

@bot.command()
@commands.has_permissions(manage_messages=True)
async def clear(ctx, amount: int):
    await ctx.channel.purge(limit=amount)
    await ctx.send(f"🧹 Cleared {amount} messages!", delete_after=3)

@bot.command()
@commands.is_owner()
async def restart(ctx):
    await ctx.send("🔄 Megatron K9 is rebooting...")
    await bot.close()

@bot.command()
@commands.is_owner()
async def eval(ctx, *, code):
    try:
        result = eval(code)
        await ctx.send(f"🧠 Output: `{result}`")
    except Exception as e:
        await ctx.send(f"❌ Error: `{e}`")

@bot.command()
async def help(ctx):
    embed = discord.Embed(
        title="📜 Megatron K9 Command List",
        description="Here’s what I can do. Choose your chaos:",
        color=discord.Color.purple()
    )
    embed.add_field(name="⚙️ Utility", value="`!ping`, `!status`, `!uptime`, `!test`", inline=False)
    embed.add_field(name="🎭 Meme", value="`!roast`, `!uwuify`, `!sus`, `!skibidi`, `!ratio`", inline=False)
    embed.add_field(name="🔒 Control", value="`!clear`, `!selfdestruct`, `!restart`", inline=False)
    embed.add_field(name="🧠 Smart", value="`!define`, `!weather`, `!time`", inline=False)
    embed.set_footer(text="Megatron K9 is always watching 💀")
    await ctx.send(embed=embed)

@bot.command()
async def menu(ctx):
    await ctx.send("📂 Choose your category:\n`!utility` – Core tools\n`!meme` – Savage fun\n`!control` – Admin commands\n`!smart` – Info & logic")

@bot.command()
async def utility(ctx):
    await ctx.send("⚙️ Utility Commands:\n`!ping`, `!status`, `!uptime`, `!test`")

@bot.command()
async def meme(ctx):
    await ctx.send("🎭 Meme Commands:\n`!roast`, `!uwuify`, `!sus`, `!skibidi`, `!ratio`")

@bot.command()
async def control(ctx):
    await ctx.send("🔒 Control Commands:\n`!clear`, `!selfdestruct`, `!restart`")

@bot.command()
async def smart(ctx):
    await ctx.send("🧠 Smart Commands:\n`!define`, `!weather`, `!time`")

@bot.command()
async def statuscheck(ctx):
    embed = discord.Embed(
        title="🧠 Megatron K9 System Scan",
        description="Bot is online and operational.",
        color=discord.Color.green()
    )
    embed.add_field(name="🕒 Uptime", value=str(datetime.datetime.now(datetime.UTC) - bot.launch_time).split('.')[0], inline=False)
    embed.add_field(name="📡 Commands Loaded", value=", ".join([cmd.name for cmd in bot.commands]), inline=False)
    embed.add_field(name="🔐 Permissions", value="Safe mode: ON\nAdmin access: OFF", inline=False)
    embed.set_footer(text="Megatron K9 is stable and vibing 💥")
    await ctx.send(embed=embed)

@bot.command()
async def menuemoji(ctx):
    menu = await ctx.send("📲 React to choose:\n💀 = Roast\n🔥 = Summon\n🧹 = Clear")
    await menu.add_reaction("💀")
    await menu.add_reaction("🔥")
    await menu.add_reaction("🧹")

@bot.command()
@commands.has_permissions(administrator=True)
async def blacklist(ctx, member: discord.Member):
    blacklisted_users.add(member.id)
    await ctx.send(f"🔒 {member.mention} has been blacklisted from using Megatron K9.")

@bot.command()
@commands.has_permissions(administrator=True)
async def unblacklist(ctx, member: discord.Member):
    blacklisted_users.discard(member.id)
    await ctx.send(f"✅ {member.mention} has been removed from the blacklist.")

@bot.command()
async def serverinfo(ctx):
    guild = ctx.guild
    embed = discord.Embed(
        title=f"📡 Server Info: {guild.name}",
        color=discord.Color.green()
    )
    embed.set_thumbnail(url=guild.icon.url if guild.icon else "")
    embed.add_field(name="🆔 Server ID", value=guild.id, inline=True)
    embed.add_field(name="👑 Owner", value=guild.owner.mention, inline=True)
    embed.add_field(name="📅 Created On", value=guild.created_at.strftime("%Y-%m-%d %H:%M:%S"), inline=False)
    embed.add_field(name="👥 Members", value=guild.member_count, inline=True)
    embed.add_field(name="💬 Channels", value=len(guild.channels), inline=True)
    embed.add_field(name="🎭 Roles", value=len(guild.roles), inline=True)
    embed.set_footer(text="Megatron K9 Server Scan Complete 💀")
    await ctx.send(embed=embed)

@bot.command()
async def roleinfo(ctx, role: discord.Role = None):
    if role is None:
        await ctx.send("❌ You need to mention a role. Example: `!roleinfo @Admin`")
        return

    embed = discord.Embed(
        title=f"🎭 Role Info: {role.name}",
        color=role.color
    )
    embed.add_field(name="🆔 Role ID", value=role.id, inline=True)
    embed.add_field(name="📅 Created On", value=role.created_at.strftime("%Y-%m-%d %H:%M:%S"), inline=True)
    embed.add_field(name="👥 Members with Role", value=len(role.members), inline=True)
    embed.add_field(name="🔐 Permissions", value=", ".join([perm[0] for perm in role.permissions if perm[1]]), inline=False)
    embed.set_footer(text="Megatron K9 Role Scan Complete 💀")
    await ctx.send(embed=embed)

@bot.command()
@commands.has_permissions(ban_members=True)
async def ban(ctx, member: discord.Member, *, reason="No reason provided"):
    if member == ctx.author:
        await ctx.send("❌ You can't ban yourself, warrior.")
        return
    if member == bot.user:
        await ctx.send("❌ You dare try to ban Megatron K9? I am the system.")
        return
    try:
        await member.ban(reason=reason)
        await ctx.send(f"🔨 {member.mention} has been banned.\n📄 Reason: `{reason}`")
    except discord.Forbidden:
        await ctx.send("❌ I don't have permission to ban that user.")
    except discord.HTTPException:
        await ctx.send("⚠️ Something went wrong while trying to ban.")

        await log_action(bot, ctx, "Ban", member, reason)

@bot.command()
async def avatar(ctx, member: discord.Member = None):
    member = member or ctx.author
    avatar_url = member.avatar.url if member.avatar else member.default_avatar.url
    embed = discord.Embed(
        title=f"🖼️ Avatar of {member.display_name}",
        color=discord.Color.blurple()
    )
    embed.set_image(url=avatar_url)
    await ctx.send(embed=embed)

@bot.command()
@commands.has_permissions(manage_messages=True)
async def clearwarnings(ctx, member: discord.Member = None):
    member = member or ctx.author
    user_id = member.id
    if user_id in warning_log:
        warning_log[user_id] = []
        await ctx.send(f"🧹 Cleared all warnings for {member.mention}.")
    else:
        await ctx.send(f"✅ {member.mention} has no warnings to clear.")

        await log_action(bot, ctx, "ClearWarnings", member)

@bot.command()
@commands.has_permissions(manage_messages=True)
async def dm(ctx, member: discord.Member, *, message):
    try:
        await member.send(f"📩 Message from {ctx.author.mention}:\n{message}")
        await ctx.send(f"✅ DM sent to {member.mention}.")
    except discord.Forbidden:
        await ctx.send("❌ I can't DM that user. They might have DMs disabled.")

@bot.command()
@commands.has_permissions(administrator=True)
async def modlogview(ctx):
    if not modlog_history:
        await ctx.send("📭 No mod actions logged yet.")
        return

    embed = discord.Embed(
        title="📜 Recent Mod Actions",
        color=discord.Color.gold()
    )

    for entry in modlog_history[-5:]:  # Show last 5 actions
        embed.add_field(
            name=f"{entry['action']} – {entry['timestamp']}",
            value=f"👮 {entry['moderator']} → 🎯 {entry['target']}\n📄 {entry['reason']}",
            inline=False
        )

    await ctx.send(embed=embed)

# ✅ Run the bot
bot.run("MTQxNDE3NjY2MzUyMDAyMjU3OA.GZEuzM.SKvxNZxPxeMtvQNakLLjE3VQMNJQ3jbKKINVVs")
