# Test helper: mint a web JWT for a given user email (used when documented password is stale)
import os, sys, asyncio
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient
from utils.auth import create_access_token


async def main(email):
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    u = await db.users.find_one({"email": email})
    print(create_access_token({"user_id": str(u["_id"]), "platform": "web"}))

asyncio.run(main(sys.argv[1]))
