import instaloader

@bot.event
async def on_ready():
    print(f"💥 Megatron K9 is online as {bot.user}")

L = instaloader.Instaloader()

username = input("Enter Instagram username: ")
try:
    profile = instaloader.Profile.from_username(L.context, username)
    print(f"📸 Username: {profile.username}")
    print(f"🧠 Full Name: {profile.full_name}")
    print(f"👥 Followers: {profile.followers}")
    print(f"📤 Posts: {profile.mediacount}")
    print(f"📝 Bio: {profile.biography}")
except Exception as e:
    print(f"❌ Error: {e}")
